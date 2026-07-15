import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { ADMIN_SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "@ove/auth";
import { AdminAuthService } from "./admin-auth.service";
import { AdminService } from "./admin.service";
import { AdminBulkGrantService } from "./admin-bulk-grant.service";
import { AdminServiceIntegrationsService } from "./admin-service-integrations.service";
import { AdminMigrationService } from "./admin-migration.service";
import { AdminAccountMergeService } from "./admin-account-merge.service";
import { AdminApprovalService } from "./admin-approval.service";
import { AdminRewardRulesService } from "./admin-reward-rules.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminAuthGuard, type AuthenticatedAdminRequest } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { ServiceCode, ApprovalType, RewardRuleStatus } from "@ove/shared-types";

const serviceCodeValues = Object.values(ServiceCode) as [string, ...string[]];
const approvalTypeValues = Object.values(ApprovalType) as [string, ...string[]];
const rewardRuleStatusValues = Object.values(RewardRuleStatus) as [string, ...string[]];

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
const MfaLoginSchema = z.object({ mfaToken: z.string().min(1), code: z.string().min(6).max(6) });
const MfaEnableSchema = z.object({ code: z.string().min(6).max(6) });
const MfaDisableSchema = z.object({ password: z.string().min(1), code: z.string().min(6).max(6) });
const GrantSchema = z.object({
  walletId: z.string().min(1),
  amount: z.number().int().positive(),
  reason: z.string().min(1),
  idempotencyKey: z.string().optional(),
});
const DeductSchema = GrantSchema;
const ReverseSchema = z.object({ reason: z.string().min(1), idempotencyKey: z.string().optional() });
const HoldSchema = z.object({
  walletId: z.string().min(1),
  amount: z.number().int().positive(),
  reason: z.string().min(1),
  idempotencyKey: z.string().optional(),
});
const ReleaseSchema = z.object({ idempotencyKey: z.string().optional() });
const BulkGrantPreviewSchema = z.object({ fileName: z.string().min(1), csvContent: z.string().min(1) });
const BulkGrantExecuteSchema = z.object({
  fileName: z.string().min(1),
  csvContent: z.string().min(1),
  batchId: z.string().optional(),
});
const ServiceIntegrationActionSchema = z.object({ reason: z.string().min(1) });
const MigrationExecuteSchema = z.object({
  fileName: z.string().min(1),
  csvContent: z.string().min(1),
  batchName: z.string().min(1),
  verifiedBy: z.string().optional(),
});
const AccountMergeSchema = z.object({
  sourceAccountCode: z.string().min(1),
  targetAccountCode: z.string().min(1),
  reason: z.string().min(1),
});
const RejectApprovalSchema = z.object({ reason: z.string().min(1) });
const CreateRewardRuleSchema = z.object({
  ruleCode: z.string().min(1),
  ruleName: z.string().min(1),
  sourceService: z.enum(serviceCodeValues),
  rewardAmount: z.number().int().positive(),
  displayName: z.string().min(1),
  description: z.string().optional(),
  perUserLimit: z.number().int().positive().optional(),
  perEventLimit: z.number().int().positive().optional(),
  monthlyCountLimit: z.number().int().positive().optional(),
  monthlyAmountLimit: z.number().int().positive().optional(),
  globalAmountLimit: z.number().int().positive().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
  approvalType: z.enum(approvalTypeValues).optional(),
});
const UpdateRewardRuleSchema = z.object({
  ruleName: z.string().min(1).optional(),
  rewardAmount: z.number().int().positive().optional(),
  displayName: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(rewardRuleStatusValues).optional(),
  perUserLimit: z.number().int().positive().nullable().optional(),
  perEventLimit: z.number().int().positive().nullable().optional(),
  monthlyCountLimit: z.number().int().positive().nullable().optional(),
  monthlyAmountLimit: z.number().int().positive().nullable().optional(),
  globalAmountLimit: z.number().int().positive().nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  approvalType: z.enum(approvalTypeValues).optional(),
});

@ApiTags("admin")
@Controller("api/v1/admin")
export class AdminController {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly admin: AdminService,
    private readonly bulkGrant: AdminBulkGrantService,
    private readonly serviceIntegrations: AdminServiceIntegrationsService,
    private readonly migration: AdminMigrationService,
    private readonly accountMerge: AdminAccountMergeService,
    private readonly approvals: AdminApprovalService,
    private readonly rewardRules: AdminRewardRulesService,
  ) {}

  /** MFA未設定なら即ログイン、設定済みなら `{ mfaRequired: true, mfaToken }` を返す (指示書13章 管理画面MFA)。 */
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

  /** ログインの2段階目。パスワード認証済みの `mfaToken` と認証アプリのコードでセッションを発行する。 */
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

  /** PC向け管理ダッシュボード (指示書13章) 用の集計値・過去30日推移。 */
  @Get("dashboard-stats")
  @UseGuards(AdminAuthGuard)
  async dashboardStats() {
    return this.admin.getDashboardStats();
  }

  @Get("accounts")
  @UseGuards(AdminAuthGuard)
  async listAccounts(@Query("status") status?: string, @Query("limit") limit?: string) {
    return this.admin.listAccounts({ status, limit: limit ? Number(limit) : undefined });
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

  @Get("wallets")
  @UseGuards(AdminAuthGuard)
  async listWallets(@Query("status") status?: string, @Query("limit") limit?: string) {
    return this.admin.listWallets({ status, limit: limit ? Number(limit) : undefined });
  }

  @Get("wallets/:walletId")
  @UseGuards(AdminAuthGuard)
  async walletDetail(@Param("walletId") walletId: string) {
    return this.admin.getWalletDetail(walletId);
  }

  @Post("wallets/grant")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async grant(
    @Body(new ZodValidationPipe(GrantSchema)) body: z.infer<typeof GrantSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.admin.grant({ ...body, adminId: req.admin.id });
  }

  @Post("wallets/deduct")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async deduct(
    @Body(new ZodValidationPipe(DeductSchema)) body: z.infer<typeof DeductSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.admin.deduct({ ...body, adminId: req.admin.id });
  }

  @Post("transactions/:transactionId/reverse")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async reverse(
    @Param("transactionId") transactionId: string,
    @Body(new ZodValidationPipe(ReverseSchema)) body: z.infer<typeof ReverseSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.admin.reverse({ transactionId, ...body, adminId: req.admin.id });
  }

  @Post("wallets/hold")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async hold(
    @Body(new ZodValidationPipe(HoldSchema)) body: z.infer<typeof HoldSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.admin.hold({ ...body, adminId: req.admin.id });
  }

  @Post("holds/:holdId/release")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async release(
    @Param("holdId") holdId: string,
    @Body(new ZodValidationPipe(ReleaseSchema)) body: z.infer<typeof ReleaseSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.admin.release({ holdId, ...body, adminId: req.admin.id });
  }

  /** 指示書14章 手順1〜7: プレビュー表示のみ (ウォレットは更新しない)。 */
  @Post("bulk-grants/preview")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async bulkGrantPreview(
    @Body(new ZodValidationPipe(BulkGrantPreviewSchema)) body: z.infer<typeof BulkGrantPreviewSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.bulkGrant.preview(body.csvContent, body.fileName, req.admin.id);
  }

  /** 指示書14章 手順8〜10: 管理者確認後の実行。`batchId` は preview() のレスポンスを渡す。 */
  @Post("bulk-grants/execute")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async bulkGrantExecute(
    @Body(new ZodValidationPipe(BulkGrantExecuteSchema)) body: z.infer<typeof BulkGrantExecuteSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.bulkGrant.execute(body.csvContent, body.fileName, req.admin.id, body.batchId);
  }

  @Get("audit-logs")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "AUDITOR")
  async auditLogs(@Query("targetType") targetType?: string, @Query("limit") limit?: string) {
    return this.admin.listAuditLogs({ targetType, limit: limit ? Number(limit) : undefined });
  }

  /** APIアクセスログ一覧。指示書13章の「APIアクセスログ」画面。 */
  @Get("api-access-logs")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "AUDITOR", "INTEGRATION_ADMIN")
  async apiAccessLogs(
    @Query("serviceIntegrationId") serviceIntegrationId?: string,
    @Query("statusCode") statusCode?: string,
    @Query("limit") limit?: string,
  ) {
    return this.admin.listApiAccessLogs({
      serviceIntegrationId,
      statusCode: statusCode ? Number(statusCode) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /** 取引一覧 (全ウォレット横断)。指示書13章の「取引一覧」画面。 */
  @Get("transactions")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR", "AUDITOR")
  async listTransactions(
    @Query("accountCode") accountCode?: string,
    @Query("transactionType") transactionType?: string,
    @Query("status") status?: string,
    @Query("direction") direction?: string,
    @Query("limit") limit?: string,
  ) {
    return this.admin.listTransactions({
      accountCode,
      transactionType,
      status,
      direction,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get("reconciliation")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "AUDITOR", "OVE_OPERATOR")
  async reconciliation() {
    return this.admin.reconcile();
  }

  @Get("service-integrations")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN", "AUDITOR")
  async listServiceIntegrations() {
    return this.serviceIntegrations.list();
  }

  /** 緊急停止 (指示書5章)。以後このサービスのAPIキーによる外部APIリクエストは即座に拒否される。 */
  @Post("service-integrations/:id/suspend")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN")
  async suspendServiceIntegration(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ServiceIntegrationActionSchema)) body: z.infer<typeof ServiceIntegrationActionSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.serviceIntegrations.suspend(id, req.admin.id, body.reason);
  }

  @Post("service-integrations/:id/reactivate")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN")
  async reactivateServiceIntegration(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ServiceIntegrationActionSchema)) body: z.infer<typeof ServiceIntegrationActionSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.serviceIntegrations.reactivate(id, req.admin.id, body.reason);
  }

  /** 既存ユーザー移行の実行 (指示書15章)。CSV形式: old_user_id,old_balance */
  @Post("migrations/execute")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN")
  async executeMigration(
    @Body(new ZodValidationPipe(MigrationExecuteSchema)) body: z.infer<typeof MigrationExecuteSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.migration.execute(body.csvContent, body.fileName, body.batchName, req.admin.id, body.verifiedBy);
  }

  /** アカウント統合 (指示書6章・13章)。高額操作に準じ SUPER_ADMIN のみ許可する。 */
  @Post("accounts/merge")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN")
  async mergeAccounts(
    @Body(new ZodValidationPipe(AccountMergeSchema)) body: z.infer<typeof AccountMergeSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.accountMerge.merge({ ...body, adminId: req.admin.id });
  }

  /** 二段階承認 (指示書13章): 高額付与・高額減算の申請一覧。 */
  @Get("approval-requests")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR", "AUDITOR")
  async listApprovalRequests(@Query("status") status?: string) {
    return this.approvals.list(status);
  }

  /** 承認。申請者本人は承認できない (職務分離)。 */
  @Post("approval-requests/:id/approve")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async approveRequest(@Param("id") id: string, @Req() req: AuthenticatedAdminRequest) {
    return this.approvals.approve(id, req.admin.id);
  }

  @Post("approval-requests/:id/reject")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async rejectRequest(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(RejectApprovalSchema)) body: z.infer<typeof RejectApprovalSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.approvals.reject(id, req.admin.id, body.reason);
  }

  /** 付与ルール管理 (指示書13章)。 */
  @Get("reward-rules")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR", "EVENT_OPERATOR", "AUDITOR")
  async listRewardRules() {
    return this.rewardRules.list();
  }

  @Post("reward-rules")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN")
  async createRewardRule(
    @Body(new ZodValidationPipe(CreateRewardRuleSchema)) body: z.infer<typeof CreateRewardRuleSchema>,
  ) {
    return this.rewardRules.create(body);
  }

  @Patch("reward-rules/:ruleCode")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN")
  async updateRewardRule(
    @Param("ruleCode") ruleCode: string,
    @Body(new ZodValidationPipe(UpdateRewardRuleSchema)) body: z.infer<typeof UpdateRewardRuleSchema>,
  ) {
    return this.rewardRules.update(ruleCode, body);
  }
}
