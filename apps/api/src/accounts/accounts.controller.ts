import { Body, Controller, Get, NotFoundException, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { SessionAuthGuard, type AuthenticatedUserRequest } from "../common/session-auth.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AccountProfileUpdateSchema, type AccountProfileUpdate } from "./account-profile.dto";
import { AccountProfileService } from "./account-profile.service";
import { AccountsService } from "./accounts.service";
import { SkipTermsConsent } from "./terms-consent";
import { TermsConsentService } from "./terms-consent.service";

@ApiTags("accounts")
@Controller("api/v1/accounts")
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly termsConsent: TermsConsentService,
    private readonly profile: AccountProfileService,
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

  /**
   * プロフィール (氏名・電話・住所) と、項目ごとの要求レベル。
   *
   * 画面はここで返る`config`を見て入力欄を出し分ける。ビルド時の値ではなくAPIから
   * 取るのは、管理画面で設定を変えても再ビルドが要らないようにするため
   * (`docs/login-methods.md`のログイン方法と同じ考え方)。
   */
  @Get("me/profile")
  @UseGuards(SessionAuthGuard)
  async getProfile(@Req() req: AuthenticatedUserRequest) {
    return this.profile.get(req.account.id);
  }

  /** 指定された項目だけを更新する (省略は現状維持、空文字は削除)。 */
  @Put("me/profile")
  @UseGuards(SessionAuthGuard)
  async updateProfile(
    @Req() req: AuthenticatedUserRequest,
    @Body(new ZodValidationPipe(AccountProfileUpdateSchema)) body: AccountProfileUpdate,
  ) {
    return this.profile.update(req.account.id, body);
  }

  /**
   * 「入力しない」を記録する。促す帯を止めるためだけでなく、未入力のまま
   * 放置しているのか明示的に断ったのかを区別するため (docs/account-profile.md)。
   */
  @Post("me/profile/decline")
  @UseGuards(SessionAuthGuard)
  async declineProfile(@Req() req: AuthenticatedUserRequest) {
    return this.profile.decline(req.account.id);
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
