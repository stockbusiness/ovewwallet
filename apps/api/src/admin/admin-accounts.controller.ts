import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { AdminService } from "./admin.service";
import { AdminAccountMergeService } from "./admin-account-merge.service";
import { AccountMergeSchema } from "./dto/admin-accounts.dto";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminAuthGuard, type AuthenticatedAdminRequest } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";

@ApiTags("admin-accounts")
@Controller("api/v1/admin")
export class AdminAccountsController {
  constructor(
    private readonly admin: AdminService,
    private readonly accountMerge: AdminAccountMergeService,
  ) {}

  @Get("accounts")
  @UseGuards(AdminAuthGuard)
  async listAccounts(@Query("status") status?: string, @Query("limit") limit?: string) {
    return this.admin.listAccounts({ status, limit: limit ? Number(limit) : undefined });
  }

  /**
   * アカウント一覧CSVエクスポート (docs/admin-operations.md参照)。動的セグメント
   * `:accountId`より前に登録している (`docs/transaction-export.md`「ルーティング上の
   * 注意」と同じ理由で、後に登録すると`export`という文字列がaccountIdとして
   * 解決されてしまう)。
   */
  @Get("accounts/export")
  @UseGuards(AdminAuthGuard)
  async exportAccounts(@Query("status") status: string | undefined, @Res() res: Response) {
    const csv = await this.admin.exportAccountsCsv({ status });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="accounts.csv"');
    res.send(csv);
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
