import { Inject, Injectable } from "@nestjs/common";
import { generateId, type CollectibleHolding, type CreatedByType, type Prisma, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
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
  | { status: "revoked"; holding: CollectibleHolding };

/**
 * NFTコレクション実装指示書10章。`entitlement.revoked`のACTIVE→REVOKED遷移。
 * Holding物理削除・他Holdingの一括取消・entitlement_id変更は行わない (禁止事項)。
 * 行ロック(`lockByEntitlementId`)取得後に現在状態を再取得することで、同一entitlement_idへの
 * 同時取消要求 (管理画面手動取消と外部イベントの競合等) が二重にAuditLogを作らないようにする。
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

      const revokedAt = new Date();
      const revoked = await this.holdings.revoke(holding.id, { revokedAt, revokeReason: params.reason }, tx);

      await tx.auditLog.create({
        data: {
          id: generateId(),
          actorType: params.actorType ?? "EXTERNAL_SERVICE",
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
}
