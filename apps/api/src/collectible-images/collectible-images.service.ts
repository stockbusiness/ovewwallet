import { Inject, Injectable, Logger } from "@nestjs/common";
import { generateId, type CollectibleImage, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { extensionFor, type DetectedImageFormat } from "./image-bytes";
import { fetchCollectibleImage, ImageFetchError, type FetchLike } from "./image-fetcher";
import { ObjectStorageService } from "./object-storage";

/** 配信パス。ウォレットと同一オリジンで返すため相対パスにする。 */
export const COLLECTIBLE_IMAGE_PATH_PREFIX = "/api/v1/collectible-images";

/** 何度失敗しても諦めない、ということはしない。無駄な外部アクセスを繰り返さないため。 */
export const MAX_INGEST_ATTEMPTS = 5;

/**
 * 外部マーケットのカード画像をウォレット側へ取り込み、こちらから配信する
 * (docs/collectible-images.md)。
 *
 * **取り込みに失敗してもカードの付与は止めない。** 画像が無いことより、購入した
 * カードを受け取れないことの方が害が大きいため。失敗は記録し、後から取り直す。
 */
@Injectable()
export class CollectibleImagesService {
  private readonly logger = new Logger(CollectibleImagesService.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly storage: ObjectStorageService,
  ) {}

  /**
   * URLを取り込み対象として登録し、その場で1回だけ取得を試みる。
   *
   * 例外は投げない。呼び出し元 (カードの付与・カードマスターの保存) を止めないため。
   */
  async registerAndIngest(
    sourceUrls: (string | null | undefined)[],
    fetchImpl?: FetchLike,
  ): Promise<void> {
    const urls = uniqueUrls(sourceUrls);
    if (urls.length === 0 || !this.storage.isConfigured()) return;

    for (const url of urls) {
      try {
        await this.register(url);
        await this.ingest(url, fetchImpl);
      } catch (error) {
        this.logger.warn(
          `collectible image ingest skipped: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    }
  }

  /** 取り込み対象として記録する。既にあれば何もしない。 */
  async register(sourceUrl: string): Promise<void> {
    await this.db.collectibleImage.upsert({
      where: { sourceUrl },
      create: { id: generateId(), sourceUrl },
      update: {},
    });
  }

  /**
   * 1件を取得して保存する。既に取り込み済みなら何もしない。
   *
   * 同じ内容の画像が別URLで届いても、保存キーは内容のハッシュから決まるので
   * ストレージ上は1つで済む。
   */
  async ingest(sourceUrl: string, fetchImpl?: FetchLike): Promise<CollectibleImage | null> {
    const row = await this.db.collectibleImage.findUnique({ where: { sourceUrl } });
    if (!row || row.status === "STORED") return row;

    try {
      const fetched = await fetchCollectibleImage(sourceUrl, fetchImpl);
      const storageKey = storageKeyFor(fetched.sha256, fetched.contentType);
      await this.storage.put({
        key: storageKey,
        body: fetched.bytes,
        contentType: fetched.contentType,
      });

      return await this.db.collectibleImage.update({
        where: { sourceUrl },
        data: {
          status: "STORED",
          storageKey,
          contentType: fetched.contentType,
          byteSize: fetched.bytes.length,
          sha256: fetched.sha256,
          resolvedUrl: fetched.finalUrl,
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          lastError: null,
          storedAt: new Date(),
        },
      });
    } catch (error) {
      const message =
        error instanceof ImageFetchError || error instanceof Error
          ? error.message
          : "unknown error";
      await this.db.collectibleImage.update({
        where: { sourceUrl },
        data: {
          status: "FAILED",
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
          // 原因を追えるようにするが、URLごと丸ごと入れない (長大なエラーで行が膨らむため)。
          lastError: message.slice(0, 500),
        },
      });
      this.logger.warn(`collectible image fetch failed: ${message}`);
      return null;
    }
  }

  /**
   * 取得元URL → 配信URL の対応を引く。取り込めていないURLは含めない
   * (呼び出し側が元のURLへフォールバックする)。
   */
  async resolveStoredUrls(sourceUrls: (string | null | undefined)[]): Promise<Map<string, string>> {
    const urls = uniqueUrls(sourceUrls);
    if (urls.length === 0) return new Map();

    const rows = await this.db.collectibleImage.findMany({
      where: { sourceUrl: { in: urls }, status: "STORED" },
      select: { sourceUrl: true, sha256: true, contentType: true },
    });

    const resolved = new Map<string, string>();
    for (const row of rows) {
      if (!row.sha256 || !row.contentType) continue;
      resolved.set(row.sourceUrl, servedUrlFor(row.sha256, row.contentType as DetectedImageFormat));
    }
    return resolved;
  }

  /**
   * 取り込めていないものを拾い直す。定期実行から呼ぶ。
   *
   * 試行回数の上限に達したものは対象外。運用者が管理画面から手動で再試行できる。
   */
  async retryPending(limit: number, fetchImpl?: FetchLike): Promise<{ attempted: number; stored: number }> {
    if (!this.storage.isConfigured()) return { attempted: 0, stored: 0 };

    const rows = await this.db.collectibleImage.findMany({
      where: { status: { in: ["PENDING", "FAILED"] }, attemptCount: { lt: MAX_INGEST_ATTEMPTS } },
      orderBy: [{ lastAttemptAt: { sort: "asc", nulls: "first" } }],
      take: limit,
      select: { sourceUrl: true },
    });

    let stored = 0;
    for (const row of rows) {
      const result = await this.ingest(row.sourceUrl, fetchImpl);
      if (result?.status === "STORED") stored += 1;
    }
    return { attempted: rows.length, stored };
  }
}

/** 内容のハッシュから決まるキー。同じ画像は同じキーになる。 */
export function storageKeyFor(sha256: string, contentType: DetectedImageFormat): string {
  return `collectibles/${sha256}.${extensionFor(contentType)}`;
}

export function servedUrlFor(sha256: string, contentType: DetectedImageFormat): string {
  return `${COLLECTIBLE_IMAGE_PATH_PREFIX}/${sha256}.${extensionFor(contentType)}`;
}

function uniqueUrls(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}
