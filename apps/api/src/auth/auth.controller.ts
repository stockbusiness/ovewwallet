import { Body, Controller, NotFoundException, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { z } from "zod";
import { SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "@ove/auth";
import { AgencySsoLoginRequestSchema, type AgencySsoLoginRequest } from "@ove/shared-types";
import { AuthService, type SessionMeta } from "./auth.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { SessionAuthGuard } from "../common/session-auth.guard";
import { REFERRAL_SESSION_COOKIE_NAME, REFERRAL_COOKIE_OPTIONS } from "../referrals/referrals.controller";

/** ログインデバイス一覧向けに、リクエストから接続元情報を取り出す。 */
function sessionMetaFromRequest(req: Request): SessionMeta {
  return { ipAddress: req.ip, userAgent: req.headers["user-agent"] };
}

const RequestOtpSchema = z.object({ email: z.string().email() });
const VerifyOtpSchema = z.object({
  email: z.string().email(),
  code: z.string().length(6),
  termsAccepted: z.boolean().optional(),
});
const LineLoginSchema = z.object({ idToken: z.string().min(1), termsAccepted: z.boolean().optional() });
const SsoExchangeSchema = z.object({ code: z.string().min(1), termsAccepted: z.boolean().optional() });
const SsoIssueMockSchema = z.object({ sengokuMemberId: z.string().min(1) });

function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE_NAME, token, { ...SESSION_COOKIE_OPTIONS, expires: expiresAt });
}

@ApiTags("auth")
@Controller("api/v1/auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("email/request-otp")
  async requestOtp(@Body(new ZodValidationPipe(RequestOtpSchema)) body: z.infer<typeof RequestOtpSchema>) {
    return this.auth.requestEmailOtp(body.email);
  }

  /**
   * 6桁コードの総当たり対策として60秒10回に制限する (メールアドレス単位の5回試行上限
   * (`packages/auth/src/email-otp.ts`) に加えたIPベースの多層防御、`docs/security.md` 参照)。
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("email/verify-otp")
  async verifyOtp(
    @Body(new ZodValidationPipe(VerifyOtpSchema)) body: z.infer<typeof VerifyOtpSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.verifyEmailOtpAndLogin(
      body.email,
      body.code,
      body.termsAccepted,
      sessionMetaFromRequest(req),
    );
    setSessionCookie(res, session.token, session.expiresAt);
    return { ove_account_id: session.oveAccountId };
  }

  /** LINEログイン。MVPではIDトークン検証をモック実装 (`mock.<lineUserId>` 形式) している。 */
  @Post("line/login")
  async lineLogin(
    @Body(new ZodValidationPipe(LineLoginSchema)) body: z.infer<typeof LineLoginSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const referralCookieToken = req.cookies?.[REFERRAL_SESSION_COOKIE_NAME] as string | undefined;
    try {
      const session = await this.auth.loginWithLineMock(
        body.idToken,
        body.termsAccepted,
        referralCookieToken,
        sessionMetaFromRequest(req),
      );
      setSessionCookie(res, session.token, session.expiresAt);
      return { ove_account_id: session.oveAccountId };
    } finally {
      // 紹介Cookieは新規/既存いずれの結果でも使い切りとして削除する (実装指示書12章)。
      // セッション発行など後続処理が失敗した場合でも、紹介セッション自体は
      // アカウント作成トランザクション内で既に消費(usedAt設定)されている可能性があるため、
      // 成功/失敗にかかわらず削除する (finally)。発行時と同じオプション
      // (httpOnly/secure/sameSite) を指定しないとブラウザが削除を無視しうるため揃える。
      if (referralCookieToken) res.clearCookie(REFERRAL_SESSION_COOKIE_NAME, REFERRAL_COOKIE_OPTIONS);
    }
  }

  /**
   * 開発用: 戦国パスポート側が発行するSSOコードのモック発行エンドポイント。
   * 次期改修指示書P0-7: 正式SSO (RS256/JWKS) が完成するまでは本番で無効化する
   * (任意の`sengokuMemberId`でログインコードを発行できてしまうため)。
   */
  @Post("sso/sengoku/dev-issue")
  async devIssueSsoCode(
    @Body(new ZodValidationPipe(SsoIssueMockSchema)) body: z.infer<typeof SsoIssueMockSchema>,
  ) {
    if (process.env.NODE_ENV === "production") {
      throw new NotFoundException();
    }
    const code = await this.auth.issueMockSengokuSsoCode(body.sengokuMemberId);
    return { code };
  }

  /** 戦国パスポートSSOコード交換 (指示書10章)。 */
  @Post("sso/sengoku/exchange")
  async ssoExchange(
    @Body(new ZodValidationPipe(SsoExchangeSchema)) body: z.infer<typeof SsoExchangeSchema>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.loginWithSengokuSso(body.code, body.termsAccepted, sessionMetaFromRequest(req));
    setSessionCookie(res, session.token, session.expiresAt);
    return { ove_account_id: session.oveAccountId };
  }

  /** sengoku-ai.com代理店システムSSO (外部連携API仕様書12章)。 */
  @Post("sso/agency")
  async agencySsoLogin(
    @Body(new ZodValidationPipe(AgencySsoLoginRequestSchema)) body: AgencySsoLoginRequest,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.loginWithAgencySso(body.token, body.termsAccepted, sessionMetaFromRequest(req));
    setSessionCookie(res, session.token, session.expiresAt);
    return { ove_account_id: session.oveAccountId };
  }

  @Post("logout")
  @UseGuards(SessionAuthGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[SESSION_COOKIE_NAME];
    if (token) await this.auth.logout(token);
    res.clearCookie(SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS);
    return { success: true };
  }
}
