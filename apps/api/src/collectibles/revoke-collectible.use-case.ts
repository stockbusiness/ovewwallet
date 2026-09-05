import { Inject, Injectable } from "@nestjs/common";
import {
  generateId,
  type CollectibleHolding,
  type CreatedByType,
  type Prisma,
  type PrismaClient,
} from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { CollectibleEntitlementTombstonesRepository } from "./collectible-entitlement-tombstones.repository";
import { CollectibleHoldingsRepository } from "./collectible-holdings.repository";
import {
  ENTITLEMENT_SOURCE_SYSTEM_KEY_ALIASES,
  KNOWN_COLLECTIBLE_REVOKE_REASON_CODES,
  entitlementAdvisoryLockKey,
  logicalMarketFor,
} from "./constants";

export interface RevokeCollectibleParams {
  entitlementId: string;
  /**
   * 保有権の同一性の単位 (docs/collectible-multi-market.md)。
   *
   * **管理画面からの取消でのみ渡す。** そこでは`sourceSystemKey`に管理者IDが入るため、
   * 論理Marketを引けないから。外部イベント起点では省略し、認証済みの
   * `sourceSystemKey`から引く (受理できない送信元だったことも監査ログに残すため)。
   */
  logicalMarket?: string;
  reason: string;
  /** PR-W3-a: 構造化された取消理由コード(例: "full_refund")。既知語彙は
   * KNOWN_COLLECTIBLE_REVOKE_REASON_CODES参照。未知でも取消は継続し、別途監査記録する。 */
  reasonCode?: string | null;
  /** AuditLogの`actorId`。外部イベント起点なら`source_system_key`、管理画面起点ならadminId。 */
  sourceSystemKey: string;
  /** 既定は`EXTERNAL_SERVICE`(entitlement.revoked経由)。管理画面からの手動取消は`ADMIN`を渡す。 */
  actorType?: CreatedByType;
  eventId: string;
  correlationId?: string | null;
  /** Market側event本文のoccurred_at (Wallet側処理時刻のrevokedAtとは別軸)。 */
  occurredAt?: Date | null;
}

export type RevokeCollectibleResult =
  | { status: "not_found" }
  /** 契約v2指示書23〜24章。Holding未作成のままentitlement.revokedが先着した (revoke先行)。
   * Tombstoneを記録し、後続のentitlement.grantedがACTIVE Holdingを作らないようにする。
   * 管理画面からの手動取消(actorType==="ADMIN")では作らない (誤入力のentitlement_idを
   * 将来にわたって塞いでしまう事故を避けるため、自動イベント起点のみ対象とする)。 */
  | { status: "tombstoned" }
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
    private readonly tombstones: CollectibleEntitlementTombstonesRepository,
  ) {}

  async execute(
    params: RevokeCollectibleParams,
  ): Promise<RevokeCollectibleResult> {
    const actorType = params.actorType ?? "EXTERNAL_SERVICE";
    const isAutomated = actorType !== "ADMIN";

    // 外部イベント起点では認証済みのsource_system_keyから引く。管理画面起点では
    // 対象Holdingの値が渡ってくる。
    const requesterMarket = isAutomated
      ? logicalMarketFor(params.sourceSystemKey)
      : (params.logicalMarket ?? null);

    // 受理できない送信元 (未知のsource_system_key)。どのマーケットの
    // entitlement_idか決められないため、絞り込まずに探して監査ログだけ残す。
    if (requesterMarket === null) {
      return this.rejectUnknownSource(params, actorType);
    }

    return this.db.$transaction(async (tx) => {
      // 契約v2指示書23章。`collectible_holdings`への行ロックは対象行が無ければ何も守らないため、
      // Holding未作成のままentitlement_idを直列化するadvisory lockを別途取る
      // (grant-collectible.use-caseの同名キーと衝突させ、tombstone作成とHolding作成を排他する)。
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${entitlementAdvisoryLockKey(requesterMarket, params.entitlementId)}))`;
      await this.holdings.lockByEntitlementId(requesterMarket, params.entitlementId, tx);
      const holding = await this.holdings.findByEntitlementId(
        requesterMarket,
        params.entitlementId,
        tx,
      );
      if (!holding) {
        if (!isAutomated) return { status: "not_found" };

        const existingTombstone = await this.tombstones.findByEntitlementId(
          requesterMarket,
          params.entitlementId,
          tx,
        );
        if (!existingTombstone) {
          await this.tombstones.create(
            {
              id: generateId(),
              entitlementId: params.entitlementId,
              sourceSystemKey: params.sourceSystemKey,
              logicalMarket: requesterMarket,
              eventId: params.eventId,
              reason: params.reason,
              reasonCode: params.reasonCode ?? null,
              correlationId: params.correlationId ?? null,
              occurredAt: params.occurredAt ?? null,
              revokedAt: new Date(),
            },
            tx,
          );
          await this.recordUnknownReasonCodeIfNeeded(tx, {
            targetType: "collectible_entitlement_tombstone",
            targetId: params.entitlementId,
            actorType,
            actorId: params.sourceSystemKey,
            reasonCode: params.reasonCode,
            eventId: params.eventId,
          });
        }
        return { status: "tombstoned" };
      }
      if (holding.status === "REVOKED")
        return { status: "already_revoked", holding };

      if (isAutomated) {
        // 検索自体が論理Marketで絞られているため、ここへ来た時点で通常は一致している。
        // 残しているのは、過去に受理していたsource_system_keyを対応表から外した等で
        // 食い違いが生じたときに、黙って取り消してしまわないため (二重の歯止め)。
        const holdingMarket =
          ENTITLEMENT_SOURCE_SYSTEM_KEY_ALIASES[holding.sourceSystemKey];
        const sourceMismatch = requesterMarket !== holdingMarket;
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
      const revoked = await this.holdings.revoke(
        holding.id,
        {
          revokedAt,
          revokeReason: params.reason,
          revokeReasonCode: params.reasonCode ?? null,
          revokedBySourceSystemKey: params.sourceSystemKey,
          revokedByEventId: params.eventId,
          revokedCorrelationId: params.correlationId ?? null,
          revokedOccurredAt: params.occurredAt ?? null,
        },
        tx,
      );

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
          beforeData: {
            status: holding.status,
          } as unknown as Prisma.InputJsonValue,
          afterData: {
            status: "REVOKED",
            revokedAt: revokedAt.toISOString(),
            revokeReason: params.reason,
            eventId: params.eventId,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      await this.recordUnknownReasonCodeIfNeeded(tx, {
        targetType: "collectible_holding",
        targetId: revoked.id,
        actorType,
        actorId: params.sourceSystemKey,
        reasonCode: params.reasonCode,
        eventId: params.eventId,
      });

      return { status: "revoked", holding: revoked };
    });
  }

  /**
   * PR-W3-a レビュー指摘5: 形式上正しいが既知語彙に無いreason_codeは、取消処理自体は
   * 継続しつつ、監査ログへ別途記録する(afterDataへ入れるのは検証済みreasonCodeの値のみ)。
   * 同一event_idの再処理は`InboundEvent`の冪等キャッシュにより、この呼び出し自体が
   * 再実行されないため重複記録されない。
   */
  private async recordUnknownReasonCodeIfNeeded(
    tx: Prisma.TransactionClient,
    params: {
      targetType: string;
      targetId: string;
      actorType: CreatedByType;
      actorId: string;
      reasonCode?: string | null;
      eventId: string;
    },
  ): Promise<void> {
    if (
      !params.reasonCode ||
      KNOWN_COLLECTIBLE_REVOKE_REASON_CODES.has(params.reasonCode)
    )
      return;
    await tx.auditLog.create({
      data: {
        id: generateId(),
        actorType: params.actorType,
        actorId: params.actorId,
        actionType: "COLLECTIBLE_REVOKE_UNKNOWN_REASON_CODE",
        targetType: params.targetType,
        targetId: params.targetId,
        result: "SUCCESS",
        reason: `unknown reason_code "${params.reasonCode}" (format valid, not in known vocabulary)`,
        afterData: {
          reasonCode: params.reasonCode,
          eventId: params.eventId,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * P0-1/P1-5の拒否時AuditLog。Holdingは変更せず、`result: FAILURE`で記録する。
   * 呼び出し元の`$transaction`内で実行するため、この後に例外を投げてもAuditLogは
   * ロールバックされない (HTTPステータスの決定はUseCaseの外・ハンドラ側で行う)。
   */
  /**
   * 受理できない送信元からの取消。**取り消さないが、記録は残す。**
   *
   * どのマーケットのentitlement_idか決められないので絞り込まずに探す。見つかれば
   * 「他所のカードを取り消そうとした」記録を残せる (`COLLECTIBLE_REVOKE_SOURCE_CONFLICT`)。
   */
  private async rejectUnknownSource(
    params: RevokeCollectibleParams,
    actorType: CreatedByType,
  ): Promise<RevokeCollectibleResult> {
    const holding = await this.holdings.findAnyByEntitlementId(params.entitlementId);
    if (!holding) return { status: "not_found" };

    await this.recordFailure(this.db, holding, {
      actorType,
      actorId: params.sourceSystemKey,
      actionType: "COLLECTIBLE_REVOKE_SOURCE_CONFLICT",
      reason: `revoke source mismatch: authenticated source_system_key="${params.sourceSystemKey}" is not a known NFT market, holding.sourceSystemKey="${holding.sourceSystemKey}"`,
      eventId: params.eventId,
    });
    return { status: "source_conflict", holding };
  }

  private async recordFailure(
    tx: Prisma.TransactionClient,
    holding: CollectibleHolding,
    params: {
      actorType: CreatedByType;
      actorId: string;
      actionType: string;
      reason: string;
      eventId: string;
    },
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
        beforeData: {
          status: holding.status,
          sourceSystemKey: holding.sourceSystemKey,
        } as unknown as Prisma.InputJsonValue,
        afterData: {
          eventId: params.eventId,
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
