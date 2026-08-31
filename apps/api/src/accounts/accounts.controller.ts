import { Controller, Get, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AccountsService } from "./accounts.service";
import { TermsConsentService } from "./terms-consent.service";
import { SkipTermsConsent } from "./terms-consent";
import { SessionAuthGuard, type AuthenticatedUserRequest } from "../common/session-auth.guard";
import { Req } from "@nestjs/common";

@ApiTags("accounts")
@Controller("api/v1/accounts")
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly termsConsent: TermsConsentService,
  ) {}

  /** 利用規約の同意状態 (docs/terms-consent.md)。再同意が必要かをここで判定する。 */
  @Get("me/terms")
  @UseGuards(SessionAuthGuard)
  async termsStatus(@Req() req: AuthenticatedUserRequest) {
    return this.termsConsent.getStatus(req.account.id);
  }

  /**
   * 現行バージョンの利用規約に同意する。
   *
   * 再同意していない利用者は更新系の操作を拒否されるため、この入口自体は当然その対象から
   * 外す (でないと同意できず詰む)。
   */
  @Post("me/terms/accept")
  @UseGuards(SessionAuthGuard)
  @SkipTermsConsent()
  async acceptTerms(@Req() req: AuthenticatedUserRequest) {
    return this.termsConsent.accept(req.account.id);
  }

  @Get("me")
  @UseGuards(SessionAuthGuard)
  async me(@Req() req: AuthenticatedUserRequest) {
    return req.account;
  }

  /** ログインデバイス一覧 (docs/login-devices.md参照)。 */
  @Get("me/sessions")
  @UseGuards(SessionAuthGuard)
  async listSessions(@Req() req: AuthenticatedUserRequest) {
    return this.accounts.listSessions(req.account.id, req.sessionId);
  }

  /**
   * この端末以外からすべてログアウト (docs/login-devices.md参照)。動的セグメント
   * `:sessionId`より前に登録している (`revoke-others`という文字列がsessionIdとして
   * 解決されるのを防ぐため、docs/transaction-export.md「ルーティング上の注意」と同じ理由)。
   */
  @Post("me/sessions/revoke-others")
  @UseGuards(SessionAuthGuard)
  async revokeOtherSessions(@Req() req: AuthenticatedUserRequest) {
    return this.accounts.revokeOtherSessions(req.account.id, req.sessionId);
  }

  @Post("me/sessions/:sessionId/revoke")
  @UseGuards(SessionAuthGuard)
  async revokeSession(@Req() req: AuthenticatedUserRequest, @Param("sessionId") sessionId: string) {
    await this.accounts.revokeSession(req.account.id, sessionId);
    return { ok: true };
  }

  /**
   * ユーザー本人による退会 (docs/account-closure.md参照)。
   *
   * 規約の再同意を求めない。新しい規約に同意しない利用者から、サービスを離れる手段まで
   * 奪うことになるため。
   */
  @Post("me/close")
  @UseGuards(SessionAuthGuard)
  @SkipTermsConsent()
  async close(@Req() req: AuthenticatedUserRequest) {
    return this.accounts.requestClosure(req.account.id);
  }

  @Get(":oveAccountId")
  async getById(@Param("oveAccountId") oveAccountId: string) {
    const account = await this.accounts.getById(oveAccountId);
    if (!account) throw new NotFoundException("account not found");
    return account;
  }
}
