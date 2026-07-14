import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { ADMIN_SESSION_COOKIE_NAME, SESSION_COOKIE_OPTIONS } from "@ove/auth";
import { AdminAuthService } from "./admin-auth.service";
import { AdminService } from "./admin.service";
import { AdminBulkGrantService } from "./admin-bulk-grant.service";
import { AdminServiceIntegrationsService } from "./admin-service-integrations.service";
import { AdminMigrationService } from "./admin-migration.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminAuthGuard, type AuthenticatedAdminRequest } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";

const LoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
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

@ApiTags("admin")
@Controller("api/v1/admin")
export class AdminController {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly admin: AdminService,
    private readonly bulkGrant: AdminBulkGrantService,
    private readonly serviceIntegrations: AdminServiceIntegrationsService,
    private readonly migration: AdminMigrationService,
  ) {}

  @Post("login")
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: z.infer<typeof LoginSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, expiresInSeconds } = await this.adminAuth.login(body.email, body.password);
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

  @Get("me")
  @UseGuards(AdminAuthGuard)
  async me(@Req() req: AuthenticatedAdminRequest) {
    return { id: req.admin.id, email: req.admin.email, role: req.admin.role, displayName: req.admin.displayName };
  }

  @Get("accounts")
  @UseGuards(AdminAuthGuard)
  async listAccounts(@Query("status") status?: string, @Query("limit") limit?: string) {
    return this.admin.listAccounts({ status, limit: limit ? Number(limit) : undefined });
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
}
