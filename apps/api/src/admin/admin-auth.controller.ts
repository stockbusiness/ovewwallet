import { Body, Controller, Get, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Response } from "express";
import { z } from "zod";
import { ADMIN_SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "@ove/auth";
import { AdminAuthService } from "./admin-auth.service";
import { LoginSchema, MfaLoginSchema, MfaEnableSchema, MfaDisableSchema } from "./dto/admin-auth.dto";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminAuthGuard, type AuthenticatedAdminRequest } from "../common/admin-auth.guard";

@ApiTags("admin-auth")
@Controller("api/v1/admin")
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  /**
   * MFA未設定なら即ログイン、設定済みなら `{ mfaRequired: true, mfaToken }` を返す (指示書13章 管理画面MFA)。
   * パスワード総当たり対策として、全体既定 (60秒120回) より厳しい60秒10回に制限する
   * (`docs/security.md` の「レート制限値の見直し」参照)。
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("login")
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: z.infer<typeof LoginSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.adminAuth.login(body.email, body.password);
    if (result.mfaRequired) {
      return { success: false, mfaRequired: true, mfaToken: result.mfaToken };
    }
    res.cookie(ADMIN_SESSION_COOKIE_NAME, result.token, {
      ...SESSION_COOKIE_OPTIONS,
      expires: new Date(Date.now() + result.expiresInSeconds * 1000),
    });
    return { success: true, mfaRequired: false };
  }

  /**
   * ログインの2段階目。パスワード認証済みの `mfaToken` と認証アプリのコードでセッションを発行する。
   * TOTPコード総当たり対策として60秒10回に制限する。
   */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("login/mfa")
  async loginMfa(
    @Body(new ZodValidationPipe(MfaLoginSchema)) body: z.infer<typeof MfaLoginSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, expiresInSeconds } = await this.adminAuth.completeMfaLogin(body.mfaToken, body.code);
    res.cookie(ADMIN_SESSION_COOKIE_NAME, token, {
      ...SESSION_COOKIE_OPTIONS,
      expires: new Date(Date.now() + expiresInSeconds * 1000),
    });
    return { success: true };
  }

  @Post("logout")
  @UseGuards(AdminAuthGuard)
  async logout(@Req() req: AuthenticatedAdminRequest, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[ADMIN_SESSION_COOKIE_NAME];
    if (token) await this.adminAuth.logout(token);
    res.clearCookie(ADMIN_SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS);
    return { success: true };
  }

  /** MFA設定を開始し、認証アプリ用のシークレット/QRコード用URIを返す。 */
  @Post("mfa/setup")
  @UseGuards(AdminAuthGuard)
  async setupMfa(@Req() req: AuthenticatedAdminRequest) {
    return this.adminAuth.setupMfa(req.admin.id);
  }

  /** setupMfaで発行したシークレットの確認コードを検証し、MFAを有効化する。 */
  @Post("mfa/enable")
  @UseGuards(AdminAuthGuard)
  async enableMfa(
    @Req() req: AuthenticatedAdminRequest,
    @Body(new ZodValidationPipe(MfaEnableSchema)) body: z.infer<typeof MfaEnableSchema>,
  ) {
    await this.adminAuth.enableMfa(req.admin.id, body.code);
    return { success: true };
  }

  /** パスワード + 現在のTOTPコードでMFAを無効化する。 */
  @Post("mfa/disable")
  @UseGuards(AdminAuthGuard)
  async disableMfa(
    @Req() req: AuthenticatedAdminRequest,
    @Body(new ZodValidationPipe(MfaDisableSchema)) body: z.infer<typeof MfaDisableSchema>,
  ) {
    await this.adminAuth.disableMfa(req.admin.id, body.password, body.code);
    return { success: true };
  }

  @Get("me")
  @UseGuards(AdminAuthGuard)
  async me(@Req() req: AuthenticatedAdminRequest) {
    return {
      id: req.admin.id,
      email: req.admin.email,
      role: req.admin.role,
      displayName: req.admin.displayName,
      mfaEnabled: req.admin.mfaEnabled,
    };
  }
}
