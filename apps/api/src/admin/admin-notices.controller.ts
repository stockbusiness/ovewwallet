import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AdminNoticesService } from "./admin-notices.service";
import { CreateNoticeSchema } from "./dto/admin-notices.dto";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminAuthGuard, type AuthenticatedAdminRequest } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";

@ApiTags("admin-notices")
@Controller("api/v1/admin")
export class AdminNoticesController {
  constructor(private readonly notices: AdminNoticesService) {}

  /** お知らせ管理 (ウォレットホーム画面「お知らせ」の作成元)。 */
  @Get("notices")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR", "EVENT_OPERATOR", "AUDITOR")
  async listNotices() {
    return this.notices.list();
  }

  @Post("notices")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "EVENT_OPERATOR")
  async createNotice(
    @Body(new ZodValidationPipe(CreateNoticeSchema)) body: z.infer<typeof CreateNoticeSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.notices.create(body, req.admin.id);
  }

  @Post("notices/:id/archive")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "EVENT_OPERATOR")
  async archiveNotice(@Param("id") id: string) {
    return this.notices.archive(id);
  }
}
