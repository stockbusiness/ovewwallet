import { Body, Controller, Get, NotFoundException, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AdminAuthGuard, type AuthenticatedAdminRequest } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { isLegalSlug } from "../legal/legal-slugs";
import { AdminLegalService } from "./admin-legal.service";
import { LegalDocumentUpdateSchema } from "./dto/admin-legal.dto";

/**
 * 利用規約・プライバシーポリシー・会社情報の編集 (docs/legal-documents.md)。
 *
 * 文言はコード修正とデプロイ無しで直せるようにする。ただし利用規約の
 * **バージョンを変えると全利用者に再同意を求めることになる**ため、変更は
 * 監査ログへ残す。
 */
@ApiTags("admin-legal")
@Controller("api/v1/admin/legal")
export class AdminLegalController {
  constructor(private readonly legal: AdminLegalService) {}

  /** 未公開のものも含めて全件。 */
  @Get()
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN", "AUDITOR")
  async list() {
    return this.legal.list();
  }

  @Get(":slug")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN", "AUDITOR")
  async get(@Param("slug") slug: string) {
    if (!isLegalSlug(slug)) throw new NotFoundException("legal document not found");
    return this.legal.get(slug);
  }

  /** 指定した項目だけを更新する (省略した項目は現状維持)。 */
  @Post(":slug")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN")
  async update(
    @Param("slug") slug: string,
    @Body(new ZodValidationPipe(LegalDocumentUpdateSchema)) body: z.infer<typeof LegalDocumentUpdateSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    if (!isLegalSlug(slug)) throw new NotFoundException("legal document not found");
    const { reason, ...params } = body;
    return this.legal.update(slug, params, req.admin.id, reason);
  }
}
