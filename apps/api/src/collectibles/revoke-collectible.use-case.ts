import { Inject, Injectable } from "@nestjs/common";
import { generateId, type CollectibleHolding, type CreatedByType, type Prisma, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { NFT_MARKET_SOURCE_SYSTEM_KEYS } from "./constants";
import { CollectibleHoldingsRepository } from "./collectible-holdings.repository";

export interface RevokeCollectibleParams {
  entitlementId: string;
  reason: string;
  /** AuditLogの`actorId`。外部イベント起点なら`source_system_key`、管理画面起点ならadminId。 */
  sourceSystemKey: string;
  /** 既定は`EXTERNAL_SERVICE`(entitlement.revoked経由)。管理画面からの手動取消は`ADMIN`を渡す。 */
  actorType?: CreatedByType;
  eventId: string;
}

export type RevokeCollectibleResult =
  | { status: "not_found" }
  | { status: "already_revoked"; holding: CollectibleHolding }
  | { status: "revoked"; holding: CollectibleHolding }
  /** PR#2最終修正 P0-1: 送信元がsengoku-market以外、またはHolding作成時の送信元と不一致。 */
  | { status: "source_conflict"; holding: CollectibleHolding }
  /** PR#2最終修正 P1-5: Mintライフサイクルに入ったHoldingは自動取消できない。 */
  | { status: "manual_review_required"; holding: CollectibleHolding };

/** PR#2最終修正 P1-5: 自動取消(entitlement.revoked経由)を許可するのはACTIVEのみ。 */
const AUTO_REVOKE_ALLOWED_STATUSES = new Set(["ACTIVE"]);

/**
 * NFTコレクション実装指示書10章。`entitlement.revoked`のACTIVE→REVOKED遷移。
 * Holding物理削除・他Holdingの一括取消・entitlement_id変更は行わない (禁止事項)。
 * 行ロック(`lockByEntitlementId`)取得後に現在状態を再取得することで、同一entitlement_idへの
 * 同時取消要求 (管理画面手動取消と外部イベントの競合等) が二重にAuditLogを作らないようにする。
 *
 * PR#2最終修正 P0-1/P1-5: 送信元制限とMintライフサイクル保護は`actorType !== "ADMIN"`の
 * ときだけ適用する。管理画面からの手動取消は指示書が要求する「人によるレビュー」そのものであり、
 * ここを塞ぐとMintライフサイクル中のHoldingを訂正する手段が失われるため。
 */
@Injectable()
export class RevokeCollectibleUseCase {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly holdings: CollectibleHoldingsRepository,
  ) {}

  async execute(params: RevokeCollectibleParams): Promise<RevokeCollectibleResult> {
    return this.db.$transaction(async (tx) => {
      await this.holdings.lockByEntitlementId(params.entitlementId, tx);
      const holding = await this.holdings.findByEntitlementId(params.entitlementId, tx);
      if (!holding) return { status: "not_found" };
      if (holding.status === "REVOKED") return { status: "already_revoked", holding };

      const actorType = params.actorType ?? "EXTERNAL_SERVICE";
      const isAutomated = actorType !== "ADMIN";

      if (isAutomated) {
        const sourceMismatch =
          !NFT_MARKET_SOURCE_SYSTEM_KEYS.has(params.sourceSystemKey) || holding.sourceSystemKey !== params.sourceSystemKey;
        if (sourceMismatch) {
          await this.recordFailure(tx, holding, {
            actorType,
            actorId: params.sourceSystemKey,
            actionType: "COLLECTIBLE_REVOKE_SOURCE_CONFLICT",
            reason: `revoke source mismatch: authenticated source_system_key="${params.sourceSystemKey}", holding.sourceSystemKey="${holding.sourceSystemKey}"`,
            eventId: params.eventId,
          });
          return { status: "source_conflict", holding };
        }

        if (!AUTO_REVOKE_ALLOWED_STATUSES.has(holding.status)) {
          await this.recordFailure(tx, holding, {
            actorType,
            actorId: params.sourceSystemKey,
            actionType: "COLLECTIBLE_REVOKE_REQUIRES_REVIEW",
            reason: `holding.status="${holding.status}" is in the mint lifecycle; automatic revoke is not allowed and requires manual review`,
            eventId: params.eventId,
          });
          return { status: "manual_review_required", holding };
        }
      }

      const revokedAt = new Date();
      const revoked = await this.holdings.revoke(holding.id, { revokedAt, revokeReason: params.reason }, tx);

      await tx.auditLog.create({
        data: {
          id: generateId(),
          actorType,
          actorId: params.sourceSystemKey,
          actionType: "COLLECTIBLE_REVOKED",
          targetType: "collectible_holding",
          targetId: revoked.id,
          result: "SUCCESS",
          reason: params.reason,
          beforeData: { status: holding.status } as unknown as Prisma.InputJsonValue,
          afterData: {
            status: "REVOKED",
            revokedAt: revokedAt.toISOString(),
            revokeReason: params.reason,
            eventId: params.eventId,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      return { status: "revoked", holding: revoked };
    });
  }

  /**
   * P0-1/P1-5の拒否時AuditLog。Holdingは変更せず、`result: FAILURE`で記録する。
   * 呼び出し元の`$transaction`内で実行するため、この後に例外を投げてもAuditLogは
   * ロールバックされない (HTTPステータスの決定はUseCaseの外・ハンドラ側で行う)。
   */
  private async recordFailure(
    tx: Prisma.TransactionClient,
    holding: CollectibleHolding,
    params: { actorType: CreatedByType; actorId: string; actionType: string; reason: string; eventId: string },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        id: generateId(),
        actorType: params.actorType,
        actorId: params.actorId,
        actionType: params.actionType,
        targetType: "collectible_holding",
        targetId: holding.id,
        result: "FAILURE",
        reason: params.reason,
        beforeData: { status: holding.status, sourceSystemKey: holding.sourceSystemKey } as unknown as Prisma.InputJsonValue,
        afterData: { eventId: params.eventId } as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
