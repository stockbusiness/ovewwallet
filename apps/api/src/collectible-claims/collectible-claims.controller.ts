import { randomUUID } from "node:crypto";
import { Controller, Get, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { SESSION_COOKIE_NAME } from "@ove/auth";
import { SessionAuthGuard, type AuthenticatedUserRequest } from "../common/session-auth.guard";
import { CLAIM_SESSION_TTL_MS } from "./claim-session-resolver.service";
import { ConfirmClaimUseCase } from "./confirm-claim.use-case";
import { GetClaimOverviewUseCase } from "./get-claim-overview.use-case";
import { OptionalSessionLookupService } from "./optional-session-lookup.service";

const CLAIM_SESSION_COOKIE_NAME = "claim_session";
const CLAIM_SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
};

/** 指示書13章。Claim TokenがURLクエリ等に残っている間のReferer漏えい・キャッシュ対策。 */
function applyClaimSecurityHeaders(res: Response): void {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");
}

/**
 * NFTカードClaim導線実装指示書8・9章。`GET`は未ログインでも呼べる公開API、
 * `POST .../confirm`は`SessionAuthGuard`必須。ブラウザから戦国マーケットへ
 * 直接アクセスさせず、必ずこのAPIがサーバー間で中継する。
 */
@ApiTags("collectible-claims")
@Controller("api/v1/collectible-claims")
export class CollectibleClaimsController {
  constructor(
    private readonly overview: GetClaimOverviewUseCase,
    private readonly confirmUseCase: ConfirmClaimUseCase,
    private readonly optionalSession: OptionalSessionLookupService,
  ) {}

  @Get(":token")
  async getOverview(
    @Param("token") token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, unknown>> {
    applyClaimSecurityHeaders(res);
    const correlationId = randomUUID();
    const result = await this.overview.execute(token, correlationId);

    if (result.claimSessionId) {
      res.cookie(CLAIM_SESSION_COOKIE_NAME, result.claimSessionId, {
        ...CLAIM_SESSION_COOKIE_OPTIONS,
        maxAge: CLAIM_SESSION_TTL_MS,
      });
    }

    const requiresLogin = !(await this.optionalSession.isLoggedIn(req.cookies?.[SESSION_COOKIE_NAME]));

    switch (result.outcome) {
      case "ok":
        res.status(200);
        return {
          claim_session_id: result.claimSessionId,
          status: result.status,
          card_name: result.cardName,
          expires_at: result.expiresAt,
          requires_login: requiresLogin,
        };
      case "not_found":
        res.status(404);
        return { claim_session_id: result.claimSessionId, error: "not_found" };
      case "expired":
        res.status(410);
        return { claim_session_id: result.claimSessionId, error: "expired" };
      case "disabled":
        res.status(503);
        return { error: "disabled" };
    }
  }

  @Post(":token/confirm")
  @UseGuards(SessionAuthGuard)
  // 指示書13章「Confirm rate limit」。SessionAuthGuard必須で匿名連打はできないため
  // メールOTP(10/分)ほど厳しくする必要はないが、ブルートフォース的な連続実行は抑止する。
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async confirmClaim(
    @Param("token") token: string,
    @Req() req: AuthenticatedUserRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Record<string, unknown>> {
    applyClaimSecurityHeaders(res);
    const correlationId = randomUUID();
    // ブラウザBodyからove_account_id/common_user_idを受け取らず、必ずセッションから
    // 解決したreq.accountの値だけを使う (指示書6章)。
    const result = await this.confirmUseCase.execute({
      tokenOrSessionId: token,
      oveAccountId: req.account.id,
      commonUserId: req.account.commonUserId,
      correlationId,
    });

    switch (result.outcome) {
      case "accepted":
        res.status(202);
        return { ok: true, status: result.status };
      case "common_user_unresolved":
        res.status(202);
        // 指示書v2「common_user_id未解決」レスポンス契約: { ok: true, action: "common_user_unresolved" }
        return { ok: true, action: "common_user_unresolved" };
      case "not_found":
        res.status(404);
        return { ok: false, error: "not_found" };
      case "expired":
        res.status(410);
        return { ok: false, error: "expired" };
      case "revoked":
        res.status(409);
        return { ok: false, error: "revoked" };
      case "common_user_mismatch":
        res.status(409);
        return { ok: false, error: "common_user_mismatch" };
      case "processing":
        res.status(409);
        return { ok: false, error: "processing" };
      case "disabled":
      case "timeout":
      case "network_error":
      case "invalid_response":
        res.status(503);
        return { ok: false, error: "service_unavailable" };
    }
  }
}
