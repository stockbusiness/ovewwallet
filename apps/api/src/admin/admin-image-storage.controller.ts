import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { AdminAuthGuard, type AuthenticatedAdminRequest } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminImageStorageService } from "./admin-image-storage.service";
import { ImageStorageConfigUpdateSchema } from "./dto/admin-image-storage.dto";

/**
 * カード画像の保管先設定 (docs/collectible-images.md)。
 * **シークレットの生値は返さない** (末尾4文字のみのマスク表示)。
 */
@ApiTags("admin-image-storage")
@Controller("api/v1/admin/image-storage-config")
export class AdminImageStorageController {
  constructor(private readonly imageStorage: AdminImageStorageService) {}

  @Get()
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN", "AUDITOR")
  async get() {
    return this.imageStorage.get();
  }

  @Post()
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN")
  async update(
    @Body(new ZodValidationPipe(ImageStorageConfigUpdateSchema))
    body: z.infer<typeof ImageStorageConfigUpdateSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    const { reason, ...params } = body;
    return this.imageStorage.update(params, req.admin.id, reason);
  }

  /** 接続テスト。外部への書き込みを伴うので回数を絞る。 */
  @Post("test")
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN")
  async test(@Req() req: AuthenticatedAdminRequest) {
    return this.imageStorage.testConnection(req.admin.id);
  }
}
