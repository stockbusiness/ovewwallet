import { Body, Controller, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AdminService } from "./admin.service";
import { AdminApprovalService } from "./admin-approval.service";
import { ResolveReviewSchema, MigrationRequestSchema } from "./dto/admin-migrations.dto";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminAuthGuard, type AuthenticatedAdminRequest } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";

@ApiTags("admin-migrations")
@Controller("api/v1/admin")
export class AdminMigrationsController {
  constructor(
    private readonly admin: AdminService,
    private readonly approvals: AdminApprovalService,
  ) {}

  /**
   * 既存ユーザー移行 (指示書15章) の検証者フロー: 残高不明で `REVIEWING` になった
   * アカウントを、検証者が調査した確認済み残高で解消する。推定値は一切自動で
   * 入れない (`docs/migration.md` 参照)。
   */
  @Post("accounts/:accountId/resolve-review")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async resolveAccountReview(
    @Param("accountId") accountId: string,
    @Body(new ZodValidationPipe(ResolveReviewSchema)) body: z.infer<typeof ResolveReviewSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.admin.resolveReview({ accountId, ...body, verifiedBy: req.admin.id });
  }

  /**
   * 既存ユーザー移行の実行を申請する (指示書15章)。CSV形式: old_user_id,old_balance。
   * 金額によらず常に二段階承認 (申請者と別の管理者による承認、
   * `approval-requests/:id/approve`) を経てから実際の移行が実行される。
   * この呼び出し自体では移行は行われない。
   */
  @Post("migrations/request")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN")
  async requestMigrationExecution(
    @Body(new ZodValidationPipe(MigrationRequestSchema)) body: z.infer<typeof MigrationRequestSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    const approvalRequest = (await this.approvals.requestMigrationExecution({
      ...body,
      requestedBy: req.admin.id,
    })) as { id: string };
    return { result: "PENDING_APPROVAL" as const, approvalRequestId: approvalRequest.id };
  }
}
