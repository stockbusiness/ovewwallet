import { Inject, Injectable } from "@nestjs/common";
import { generateId, Prisma, type PrismaClient } from "@ove/database";
import {
  CollectibleImagesService,
  MAX_INGEST_ATTEMPTS,
  type CollectibleImageStats,
} from "../collectible-images/collectible-images.service";
import { ObjectStorageService } from "../collectible-images/object-storage";
import { PRISMA } from "../common/prisma.module";

/** 一覧に出す直近の失敗の件数。原因の傾向が読めれば足りるので絞る。 */
const RECENT_FAILURE_LIMIT = 20;

/**
 * 手動実行で取得を試みる枚数。定期実行(20件)より少ない。HTTPリクエストの中で
 * 外部から画像を取りに行くため、応答が返るうちに終わる範囲に収める。
 */
const MANUAL_INGEST_LIMIT = 10;

/** 手動実行の打ち切り時刻。1件あたり最大10秒かかりうるので時間でも止める。 */
const MANUAL_INGEST_BUDGET_MS = 20_000;

/**
 * カード画像の取り込み状況を管理画面から見て、手動で走らせる
 * (docs/collectible-images.md)。
 *
 * 保管先の設定 (`AdminImageStorageService`) とは別にしている。設定は滅多に触らない
 * シークレットの管理で、こちらは日々の取り込みの様子を見るためのもの。
 */
@Injectable()
export class AdminCollectibleImagesService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly images: CollectibleImagesService,
    private readonly storage: ObjectStorageService,
  ) {}

  async status(): Promise<{
    configured: boolean;
    maxAttempts: number;
    counts: CollectibleImageStats;
    recentFailures: Awaited<ReturnType<CollectibleImagesService["recentFailures"]>>;
  }> {
    const [configured, counts, recentFailures] = await Promise.all([
      this.storage.isConfigured(),
      this.images.stats(),
      this.images.recentFailures(RECENT_FAILURE_LIMIT),
    ]);
    return { configured, maxAttempts: MAX_INGEST_ATTEMPTS, counts, recentFailures };
  }

  /**
   * 取り込みを今すぐ走らせる。定期実行(15分ごと)を待たずに結果を見たいときに使う。
   *
   * 取りこぼしの登録 → 取得、の順で行う。時間切れで取得しきれなかった分は
   * 次の定期実行が拾うため、押し直す必要はない。
   */
  async runIngest(
    adminId: string,
    reason: string,
    resetExhausted: boolean,
  ): Promise<{
    configured: boolean;
    reset: number;
    registered: number;
    attempted: number;
    stored: number;
  }> {
    const configured = await this.storage.isConfigured();
    if (!configured) {
      // 保管先が未設定なら何も動かさない。押しても無反応に見えるのを避けるため、
      // 実行しなかったことを呼び出し元へ返す。
      return { configured: false, reset: 0, registered: 0, attempted: 0, stored: 0 };
    }

    const reset = resetExhausted ? await this.images.resetExhausted() : 0;
    const registered = await this.images.backfillFromCatalog(MANUAL_INGEST_LIMIT * 10);
    const result = await this.images.retryPending(
      MANUAL_INGEST_LIMIT,
      undefined,
      Date.now() + MANUAL_INGEST_BUDGET_MS,
    );

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType: "COLLECTIBLE_IMAGE_INGEST_RUN",
        targetType: "collectible_images",
        targetId: "manual",
        result: "SUCCESS",
        reason,
        afterData: {
          reset,
          registered,
          attempted: result.attempted,
          stored: result.stored,
        } as Prisma.InputJsonValue,
      },
    });

    return { configured: true, reset, registered, ...result };
  }
}
