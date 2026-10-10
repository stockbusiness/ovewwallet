import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { AdminService } from "./admin.service";
import { AdminAccountMergeService } from "./admin-account-merge.service";
import { AccountAnonymizationService } from "../accounts/account-anonymization.service";
import { AccountMergeSchema, ResolveCommonUserSchema } from "./dto/admin-accounts.dto";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminAuthGuard, type AuthenticatedAdminRequest } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { AdminCommonUserResolveService } from "./admin-common-user-resolve.service";
import { AdminWalletUserReferralsService } from "./admin-wallet-user-referrals.service";

@ApiTags("admin-accounts")
@Controller("api/v1/admin")
export class AdminAccountsController {
  constructor(
    private readonly admin: AdminService,
    private readonly accountMerge: AdminAccountMergeService,
    private readonly anonymization: AccountAnonymizationService,
    private readonly commonUserResolve: AdminCommonUserResolveService,
    private readonly walletUserReferrals: AdminWalletUserReferralsService,
  ) {}

  /**
   * アカウント一覧。`search`はアカウントコード・メールアドレス・電話番号・表示名・
   * common_user_idを横断する部分一致で、問い合わせ対応の入口になる
   * (利用者から提示される情報が項目ごとにまちまちなため、1つの入力欄で引けるようにする)。
   */
  @Get("accounts")
  @UseGuards(AdminAuthGuard)
  async listAccounts(
    @Query("status") status?: string,
    @Query("search") search?: string,
    @Query("limit") limit?: string,
  ) {
    return this.admin.listAccounts({ status, search, limit: limit ? Number(limit) : undefined });
  }

  /**
   * アカウント一覧CSVエクスポート (docs/admin-operations.md参照)。動的セグメント
   * `:accountId`より前に登録している (`docs/transaction-export.md`「ルーティング上の
   * 注意」と同じ理由で、後に登録すると`export`という文字列がaccountIdとして
   * 解決されてしまう)。
   */
  @Get("accounts/export")
  @UseGuards(AdminAuthGuard)
  async exportAccounts(
    @Query("status") status: string | undefined,
    @Query("search") search: string | undefined,
    @Res() res: Response,
  ) {
    const csv = await this.admin.exportAccountsCsv({ status, search });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="accounts.csv"');
    res.send(csv);
  }

  /**
   * 退会済みアカウントの匿名化ドライラン (`docs/account-anonymization.md`)。
   *
   * 匿名化は不可逆なので、`ENABLE_ACCOUNT_ANONYMIZATION`を有効化する**前に**
   * 「今有効にすると何件が対象になるか」を確認するための入口。件数のみを返し、
   * 個人情報は一切返さない。
   *
   * 動的セグメント`:accountId`より前に登録している (`accounts/export`と同じ理由で、
   * 後に登録するとこの文字列がaccountIdとして解決されてしまう)。
   */
  @Get("accounts/anonymization-preview")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN")
  async anonymizationPreview() {
    return this.anonymization.preview();
  }

  /** アカウント詳細画面 (指示書13章): 連携ID・外部サービス連携・ウォレット・操作ログ。 */
  @Get("accounts/:accountId")
  @UseGuards(AdminAuthGuard)
  async accountDetail(@Param("accountId") accountId: string) {
    return this.admin.getAccountDetail(accountId);
  }

  /** 全セッション無効化 (指示書16章): 不正利用が疑われるアカウントを全端末から強制ログアウトする。 */
  @Post("accounts/:accountId/revoke-sessions")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async revokeAccountSessions(
    @Param("accountId") accountId: string,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.admin.revokeAllSessions(accountId, req.admin.id);
  }

  /**
   * ウォレット紹介の可視化 (`docs/wallet-user-referral.md`)。
   *
   * このアカウントを紹介した人と、このアカウントが紹介した人を返す。成立しなかった
   * 関係 (代理店紹介が優先された `EXCLUDED`・期限切れの `EXPIRED`) とその理由も
   * 含める。「紹介したはずなのに数に入らない」という問い合わせに答えるため。
   *
   * アカウント詳細とは別エンドポイントにしている。詳細の応答をこれ以上重くせず、
   * 取得に失敗してもアカウント詳細画面自体は表示を続けられるようにするため。
   */
  @Get("accounts/:accountId/wallet-user-referrals")
  @UseGuards(AdminAuthGuard)
  async accountWalletUserReferrals(@Param("accountId") accountId: string) {
    return this.walletUserReferrals.forAccount(accountId);
  }

  /**
   * 共通IDの再解決 (バックフィル)。
   *
   * `common_user_id`は**アカウント新規登録時の自動解決**か共通イベント受信でしか
   * 入らず、登録時の解決はベストエフォート (共通顧客HUBが未設定・誤設定でも登録は
   * 成功する) なため、その期間に作られたアカウントは空のまま固定されてしまう。
   * 共通IDが無いと`entitlement.granted`が404になり、カード受取も確定手前で止まる。
   * 実運用で詰まったため、あとから解決し直せる入口を用意する。
   *
   * 冪等 (既に同じIDが紐付いていれば`already_linked`を返すだけ)。別アカウントに
   * 紐付いている場合は自動解決せず`conflict`を返す (統合は二段階承認が必要な
   * `accounts/merge`の責務)。
   */
  @Post("accounts/:accountId/resolve-common-user")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async resolveCommonUser(
    @Param("accountId") accountId: string,
    @Body(new ZodValidationPipe(ResolveCommonUserSchema)) body: z.infer<typeof ResolveCommonUserSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.commonUserResolve.run(accountId, req.admin.id, body.reason);
  }

  /**
   * アカウント統合 (指示書6章・13章)。SUPER_ADMINのみ申請可能で、金額によらず常に
   * 二段階承認 (申請者と別の管理者による承認、`approval-requests/:id/approve`) を経てから
   * 実際の統合が実行される。この呼び出し自体では統合は行われない。
   */
  @Post("accounts/merge")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN")
  async mergeAccounts(
    @Body(new ZodValidationPipe(AccountMergeSchema)) body: z.infer<typeof AccountMergeSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.accountMerge.requestMerge({ ...body, adminId: req.admin.id });
  }
}
