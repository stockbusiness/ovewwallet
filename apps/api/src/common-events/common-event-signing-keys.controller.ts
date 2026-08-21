import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AdminAuthGuard } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CommonEventSigningKeysService } from "./common-event-signing-keys.service";

const CreateKeySchema = z.object({
  keyId: z.string().min(1).max(100),
  sourceSystemKey: z.string().min(1).max(100),
  secret: z.string().min(16).max(500),
  /** 明示的に許可するevent_type一覧 (末尾".*"でprefix一致)。未指定/空配列は何も許可しない。 */
  allowedEventTypes: z.array(z.string().min(1).max(100)).default([]),
});

/**
 * 共通イベント契約6.1章の`X-SenNoKuni-Key-Id`に対応する送信元別HMAC鍵の管理API。
 * 管理画面フロントエンド(`apps/admin-wallet`)は今回未対応 (未対応事項参照) — 当面は
 * この管理APIまたはSwagger UI (`/api/docs`) から直接発行・失効操作を行う。
 */
@ApiTags("admin-common-event-signing-keys")
@Controller("api/v1/admin/common-event-signing-keys")
@UseGuards(AdminAuthGuard, RolesGuard)
export class CommonEventSigningKeysController {
  constructor(private readonly signingKeys: CommonEventSigningKeysService) {}

  @Get()
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN", "AUDITOR")
  async list() {
    return this.signingKeys.list();
  }

  @Post()
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN")
  async create(
    @Body(new ZodValidationPipe(CreateKeySchema))
    body: z.infer<typeof CreateKeySchema>,
  ) {
    return this.signingKeys.create(body);
  }

  @Post(":keyId/revoke")
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN")
  async revoke(@Param("keyId") keyId: string) {
    return this.signingKeys.revoke(keyId);
  }
}
