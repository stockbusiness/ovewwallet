import { Inject, Injectable, Logger } from "@nestjs/common";
import { generateId, type CollectibleImage, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { extensionFor, type DetectedImageFormat } from "./image-bytes";
import { countUnregisteredCatalogUrls, findUnregisteredCatalogUrls } from "./image-catalog";
import { fetchCollectibleImage, ImageFetchError, type FetchLike } from "./image-fetcher";
import { ObjectStorageService } from "./object-storage";

/** 配信パス。ウォレットと同一オリジンで返すため相対パスにする。 */
export const COLLECTIBLE_IMAGE_PATH_PREFIX = "/api/v1/collectible-images";

/** 何度失敗しても諦めない、ということはしない。無駄な外部アクセスを繰り返さないため。 */
export const MAX_INGEST_ATTEMPTS = 5;

/** 取り込み状況の内訳。管理画面に出す (docs/collectible-images.md)。 */
export interface CollectibleImageStats {
  /** 取り込み待ち。まだ一度も成功していないが、再試行の余地がある。 */
  pending: number;
  /** 取り込み済み。ウォレット自身が配信している。 */
  stored: number;
  /** 失敗したが、まだ再試行の対象。 */
  failed: number;
  /** 試行回数の上限に達し、定期実行が拾わなくなったもの。 */
  exhausted: number;
  /** カードに載っているのに取り込み対象へ入っていないURLの件数。 */
  unregistered: number;
}

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
    if (urls.length === 0 || !(await this.storage.isConfigured())) return;

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
   * 取り込めていないものを拾い直す。定期実行と管理画面の手動実行から呼ぶ。
   *
   * 試行回数の上限に達したものは対象外。運用者が管理画面から
   * `resetExhausted()`で再試行の対象へ戻せる。
   *
   * `deadline`(エポックミリ秒)を渡すと、その時刻を過ぎた時点で打ち切る。手動実行は
   * HTTPリクエストの中で走り、1件あたり最大10秒かかりうるため、応答が返らなくなる
   * のを避ける。打ち切った分は次の定期実行が拾う。
   */
  async retryPending(
    limit: number,
    fetchImpl?: FetchLike,
    deadline?: number,
  ): Promise<{ attempted: number; stored: number }> {
    if (!(await this.storage.isConfigured())) return { attempted: 0, stored: 0 };

    const rows = await this.db.collectibleImage.findMany({
      where: { status: { in: ["PENDING", "FAILED"] }, attemptCount: { lt: MAX_INGEST_ATTEMPTS } },
      orderBy: [{ lastAttemptAt: { sort: "asc", nulls: "first" } }],
      take: limit,
      select: { sourceUrl: true },
    });

    let attempted = 0;
    let stored = 0;
    for (const row of rows) {
      if (deadline !== undefined && Date.now() >= deadline) break;
      attempted += 1;
      const result = await this.ingest(row.sourceUrl, fetchImpl);
      if (result?.status === "STORED") stored += 1;
    }
    return { attempted, stored };
  }

  /**
   * カードに載っているのに取り込み対象へ入っていないURLを登録する。
   *
   * 取得はここでは行わない (登録だけで戻る)。続けて`retryPending()`が拾う。
   * ストレージ未設定の間は何もしない — 取り込めないものを待ち行列に積んでも、
   * 試行回数だけが減っていくため。
   */
  async backfillFromCatalog(limit: number): Promise<number> {
    if (!(await this.storage.isConfigured())) return 0;

    const urls = await findUnregisteredCatalogUrls(this.db, limit);
    for (const url of urls) {
      await this.register(url);
    }
    return urls.length;
  }

  /**
   * 試行回数の上限に達したものを、もう一度定期実行の対象へ戻す。
   *
   * 失敗の理由(`lastError`)は消さない。取得元が直ったのかどうかを、戻したあとも
   * 運用者が読めるようにするため。
   */
  async resetExhausted(): Promise<number> {
    const result = await this.db.collectibleImage.updateMany({
      where: { status: { not: "STORED" }, attemptCount: { gte: MAX_INGEST_ATTEMPTS } },
      data: { status: "PENDING", attemptCount: 0 },
    });
    return result.count;
  }

  /** 取り込み状況の内訳。管理画面の表示に使う。 */
  async stats(): Promise<CollectibleImageStats> {
    const [pending, stored, failed, exhausted, unregistered] = await Promise.all([
      this.db.collectibleImage.count({
        where: { status: "PENDING", attemptCount: { lt: MAX_INGEST_ATTEMPTS } },
      }),
      this.db.collectibleImage.count({ where: { status: "STORED" } }),
      this.db.collectibleImage.count({
        where: { status: "FAILED", attemptCount: { lt: MAX_INGEST_ATTEMPTS } },
      }),
      this.db.collectibleImage.count({
        where: { status: { not: "STORED" }, attemptCount: { gte: MAX_INGEST_ATTEMPTS } },
      }),
      countUnregisteredCatalogUrls(this.db),
    ]);
    return { pending, stored, failed, exhausted, unregistered };
  }

  /** 直近の失敗。原因を運用者が読めるようにするためで、利用者には見せない。 */
  async recentFailures(limit: number) {
    return this.db.collectibleImage.findMany({
      where: { status: "FAILED" },
      orderBy: [{ lastAttemptAt: { sort: "desc", nulls: "last" } }],
      take: limit,
      select: {
        sourceUrl: true,
        attemptCount: true,
        lastAttemptAt: true,
        lastError: true,
      },
    });
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
