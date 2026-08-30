import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AdminUsersService } from "./admin-users.service";
import { AdminAuthService } from "./admin-auth.service";
import {
  ChangeOwnPasswordSchema,
  CreateAdminUserSchema,
  ResetAdminPasswordSchema,
  UpdateAdminUserSchema,
} from "./dto/admin-users.dto";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminAuthGuard, type AuthenticatedAdminRequest } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";

/**
 * 管理者アカウントの管理。他の管理者を操作する系はすべて SUPER_ADMIN 限定。
 *
 * 初期パスワード・リセット後のパスワードはレスポンスで1回だけ返す (DBにはハッシュのみ
 * 保存するため後から再表示できない)。運用上は口頭・別経路で本人へ渡し、本人が
 * `POST /api/v1/admin/password` で速やかに変更する。
 */
@ApiTags("admin-users")
@Controller("api/v1/admin")
export class AdminUsersController {
  constructor(
    private readonly adminUsers: AdminUsersService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  @Get("admins")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "AUDITOR")
  async list() {
    return this.adminUsers.list();
  }

  @Post("admins")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN")
  async create(
    @Body(new ZodValidationPipe(CreateAdminUserSchema)) body: z.infer<typeof CreateAdminUserSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.adminUsers.create(body, req.admin.id);
  }

  @Patch("admins/:id")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN")
  async update(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateAdminUserSchema)) body: z.infer<typeof UpdateAdminUserSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.adminUsers.update(id, body, req.admin.id);
  }

  @Post("admins/:id/reset-password")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN")
  async resetPassword(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ResetAdminPasswordSchema)) body: z.infer<typeof ResetAdminPasswordSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.adminUsers.resetPassword(id, body.reason, req.admin.id);
  }

  /** 自分のパスワード変更。ロールを問わず、ログイン中の管理者本人だけが実行できる。 */
  @Post("password")
  @UseGuards(AdminAuthGuard)
  async changeOwnPassword(
    @Body(new ZodValidationPipe(ChangeOwnPasswordSchema)) body: z.infer<typeof ChangeOwnPasswordSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    await this.adminAuth.changeOwnPassword(req.admin.id, body.currentPassword, body.newPassword);
    return { success: true };
  }
}
