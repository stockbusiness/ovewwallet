import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { AdminService } from "./admin.service";
import { AdminBulkGrantService } from "./admin-bulk-grant.service";
import {
  GrantSchema,
  DeductSchema,
  ReverseSchema,
  HoldSchema,
  ReleaseSchema,
  BulkGrantPreviewSchema,
  BulkGrantExecuteSchema,
} from "./dto/admin-wallets.dto";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminAuthGuard, type AuthenticatedAdminRequest } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";

@ApiTags("admin-wallets")
@Controller("api/v1/admin")
export class AdminWalletsController {
  constructor(
    private readonly admin: AdminService,
    private readonly bulkGrant: AdminBulkGrantService,
  ) {}

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

  /** 監査ログCSVエクスポート (docs/admin-operations.md参照)。 */
  @Get("audit-logs/export")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "AUDITOR")
  async exportAuditLogs(@Query("targetType") targetType: string | undefined, @Res() res: Response) {
    const csv = await this.admin.exportAuditLogsCsv({ targetType });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="audit-logs.csv"');
    res.send(csv);
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
}
