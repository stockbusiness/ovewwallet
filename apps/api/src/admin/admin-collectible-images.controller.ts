import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { z } from "zod";
import { AdminAuthGuard, type AuthenticatedAdminRequest } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminCollectibleImagesService } from "./admin-collectible-images.service";
import { CollectibleImageIngestSchema } from "./dto/admin-image-storage.dto";

/**
 * カード画像の取り込み状況 (docs/collectible-images.md)。
 * 失敗の理由は運用者向けで、利用者の画面には出さない。
 */
@ApiTags("admin-collectible-images")
@Controller("api/v1/admin/collectible-images")
export class AdminCollectibleImagesController {
  constructor(private readonly images: AdminCollectibleImagesService) {}

  @Get("status")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN", "AUDITOR")
  async status() {
    return this.images.status();
  }

  /** 手動実行。外部への取得を伴うので回数を絞る。 */
  @Post("ingest")
  @Throttle({ default: { limit: 10, ttl: 300_000 } })
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN")
  async ingest(
    @Body(new ZodValidationPipe(CollectibleImageIngestSchema))
    body: z.infer<typeof CollectibleImageIngestSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.images.runIngest(req.admin.id, body.reason, body.resetExhausted === true);
  }
}
