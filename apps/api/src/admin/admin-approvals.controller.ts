import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AdminApprovalService } from "./admin-approval.service";
import { RejectApprovalSchema } from "./dto/admin-approvals.dto";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminAuthGuard, type AuthenticatedAdminRequest } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";

@ApiTags("admin-approvals")
@Controller("api/v1/admin")
export class AdminApprovalsController {
  constructor(private readonly approvals: AdminApprovalService) {}

  /** 二段階承認 (指示書13章): 高額付与・高額減算・アカウント統合の申請一覧。 */
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
}
