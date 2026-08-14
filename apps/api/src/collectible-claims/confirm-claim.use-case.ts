import { Inject, Injectable } from "@nestjs/common";
import { generateId, type CreatedByType, type Prisma, type PrismaClient } from "@ove/database";
import { isFeatureEnabled } from "../common/feature-flags";
import { PRISMA } from "../common/prisma.module";
import { SengokuMarketClaimAdapter } from "../integrations/sengoku-market-claim.adapter";
import { ClaimSessionResolver } from "./claim-session-resolver.service";

export type ConfirmClaimResult =
  | { outcome: "accepted"; status: string }
  | { outcome: "common_user_unresolved" }
  | { outcome: "market_common_user_pending" }
  | { outcome: "not_found" }
  | { outcome: "expired" }
  | { outcome: "revoked" }
  | { outcome: "common_user_mismatch" }
  | { outcome: "processing" }
  | { outcome: "idempotency_conflict" }
  | { outcome: "disabled" }
  | { outcome: "timeout" }
  | { outcome: "network_error" }
  | { outcome: "invalid_response" };

export interface ConfirmClaimParams {
  tokenOrSessionId: string;
  oveAccountId: string;
  /** `req.account.commonUserId` (nullなら未解決 = 202 common_user_unresolved)。 */
  commonUserId: string | null;
  correlationId: string;
}

/**
 * NFTカードClaim導線実装指示書9・11章。`POST /api/v1/collectible-claims/{token}/confirm`。
 * ブラウザからのBodyにove_account_id/common_user_idを含めず、必ずセッション
 * (`SessionAuthGuard`が解決した`req.account`) から取得した値を使う (指示書6章)。
 * Idempotency-KeyはClaim SessionとAccountの組で固定し、同一ユーザーの再実行は
 * 同じ結果になる (指示書11章)。
 */
@Injectable()
export class ConfirmClaimUseCase {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly resolver: ClaimSessionResolver,
    private readonly market: SengokuMarketClaimAdapter,
  ) {}

  async execute(params: ConfirmClaimParams): Promise<ConfirmClaimResult> {
    // Feature Flag OFF時はClaim Session行を作る前に弾く (P0-3と同じ設計)。
    if (!isFeatureEnabled("ENABLE_COLLECTIBLE_CLAIM_FLOW")) {
      return { outcome: "disabled" };
    }

    const { session, rawToken } = await this.resolver.resolve(params.tokenOrSessionId);

    if (!params.commonUserId) {
      await this.audit({
        actorId: params.oveAccountId,
        actionType: "COLLECTIBLE_CLAIM_COMMON_USER_UNRESOLVED",
        targetId: session.id,
        result: "FAILURE",
      });
      return { outcome: "common_user_unresolved" };
    }

    await this.audit({
      actorId: params.oveAccountId,
      actionType: "COLLECTIBLE_CLAIM_CONFIRM_REQUESTED",
      targetId: session.id,
      result: "SUCCESS",
    });

    const idempotencyKey = `wallet-claim-confirm:${session.id}:${params.oveAccountId}`;
    const marketResult = await this.market.confirmClaim({
      rawToken,
      commonUserId: params.commonUserId,
      idempotencyKey,
      correlationId: params.correlationId,
    });

    if (marketResult.outcome === "accepted") {
      await this.audit({
        actorId: params.oveAccountId,
        actionType: "COLLECTIBLE_CLAIM_CONFIRM_ACCEPTED",
        targetId: session.id,
        result: "SUCCESS",
      });
      return { outcome: "accepted", status: marketResult.status };
    }

    if (marketResult.outcome === "disabled") {
      return { outcome: "disabled" };
    }

    // 契約v2指示書13章。「拒否」ではなく一時的な保留状態のため、REJECTED監査ログは残さない。
    if (marketResult.outcome === "market_common_user_pending") {
      return { outcome: "market_common_user_pending" };
    }

    // not_found/expired/revoked/common_user_mismatch/processing/idempotency_conflict/
    // timeout/network_error/invalid_response
    await this.audit({
      actorId: params.oveAccountId,
      actionType: "COLLECTIBLE_CLAIM_REJECTED",
      targetId: session.id,
      result: "FAILURE",
      reason: marketResult.outcome,
    });
    return marketResult;
  }

  private async audit(params: {
    actorId: string;
    actionType: string;
    targetId: string;
    result: "SUCCESS" | "FAILURE";
    reason?: string;
  }): Promise<void> {
    const actorType: CreatedByType = "USER";
    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType,
        actorId: params.actorId,
        actionType: params.actionType,
        // Claim Token本体は記録しない (指示書12章)。target_idはClaim Session IDのみ。
        targetType: "claim_session",
        targetId: params.targetId,
        result: params.result,
        reason: params.reason,
      } as Prisma.AuditLogUncheckedCreateInput,
    });
  }
}
