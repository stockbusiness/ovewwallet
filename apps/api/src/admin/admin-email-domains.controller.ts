import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AdminAuthGuard, type AuthenticatedAdminRequest } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminEmailDomainsService } from "./admin-email-domains.service";
import { EmailDomainRuleRemoveSchema, EmailDomainRuleUpsertSchema } from "./dto/admin-email-domains.dto";

/**
 * 使い捨てメールドメインの個別指定 (docs/email-domain-policy.md)。
 *
 * 組み込みの一覧はコード側にあり、ここで編集するのはその差分だけ。
 */
@ApiTags("admin-email-domains")
@Controller("api/v1/admin/email-domains")
export class AdminEmailDomainsController {
  constructor(private readonly emailDomains: AdminEmailDomainsService) {}

  @Get()
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN", "AUDITOR")
  async list() {
    return {
      built_in_count: this.emailDomains.builtInCount(),
      rules: await this.emailDomains.list(),
    };
  }

  /** 同じドメインを再登録したときは上書きする (BLOCK と ALLOW の切り替えを兼ねる)。 */
  @Post()
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN")
  async upsert(
    @Body(new ZodValidationPipe(EmailDomainRuleUpsertSchema)) body: z.infer<typeof EmailDomainRuleUpsertSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.emailDomains.upsert(body, req.admin.id);
  }

  @Delete(":domain")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN")
  async remove(
    @Param(new ZodValidationPipe(EmailDomainRuleRemoveSchema)) params: z.infer<typeof EmailDomainRuleRemoveSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    await this.emailDomains.remove(params.domain, req.admin.id);
    return { ok: true };
  }
}
