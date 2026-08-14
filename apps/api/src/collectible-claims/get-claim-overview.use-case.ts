import { Inject, Injectable } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { isFeatureEnabled } from "../common/feature-flags";
import { PRISMA } from "../common/prisma.module";
import { SengokuMarketClaimAdapter, type MarketClaimStatus } from "../integrations/sengoku-market-claim.adapter";
import { ClaimSessionResolver } from "./claim-session-resolver.service";

export type ClaimOverviewResult =
  | { outcome: "ok"; claimSessionId: string; status: MarketClaimStatus; cardName: string | null; expiresAt: string | null }
  | { outcome: "not_found"; claimSessionId: string }
  | { outcome: "expired"; claimSessionId: string }
  /** 契約v2指示書26〜28章。Market側のentitlementではなく、Wallet側のSession IDが
   * 期限切れ (区別が必要なため`expired`とは別のoutcomeにする)。 */
  | { outcome: "claim_session_expired" }
  | { outcome: "disabled"; claimSessionId: string | null };

/**
 * NFTカードClaim導線実装指示書8章。`GET /api/v1/collectible-claims/{token}`。
 * 未ログインでも呼べる公開API — 個人情報 (氏名・メール・注文金額・common_user_id・
 * ove_account_id等) は一切含めない。Claim状態自体は戦国マーケットが所有するため、
 * ここでキャッシュせず毎回問い合わせる。
 */
@Injectable()
export class GetClaimOverviewUseCase {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly resolver: ClaimSessionResolver,
    private readonly market: SengokuMarketClaimAdapter,
  ) {}

  async execute(tokenOrSessionId: string, correlationId: string): Promise<ClaimOverviewResult> {
    // Feature Flag OFF時はClaim Session行を作る前に弾く (PR#2最終修正P0-3と同じ教訓:
    // 副作用のある行を作ってからFlagを見ると、後からONにしても不整合が残りうる)。
    if (!isFeatureEnabled("ENABLE_COLLECTIBLE_CLAIM_FLOW")) {
      return { outcome: "disabled", claimSessionId: null };
    }

    const resolved = await this.resolver.resolve(tokenOrSessionId);
    if (resolved.outcome === "session_expired") {
      return { outcome: "claim_session_expired" };
    }
    const { session, rawToken } = resolved;

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "USER",
        actorId: null,
        actionType: "COLLECTIBLE_CLAIM_VIEWED",
        targetType: "claim_session",
        targetId: session.id,
        result: "SUCCESS",
      },
    });

    const marketResult = await this.market.getClaimStatus(rawToken, correlationId);
    switch (marketResult.outcome) {
      case "ok":
        return {
          outcome: "ok",
          claimSessionId: session.id,
          status: marketResult.status,
          cardName: marketResult.cardName,
          expiresAt: marketResult.expiresAt,
        };
      case "not_found":
        return { outcome: "not_found", claimSessionId: session.id };
      case "expired":
        return { outcome: "expired", claimSessionId: session.id };
      default:
        // disabled/timeout/network_error/invalid_response はいずれもマーケットへ
        // 問い合わせできない状態として一律503相当にする。
        return { outcome: "disabled", claimSessionId: session.id };
    }
  }
}
