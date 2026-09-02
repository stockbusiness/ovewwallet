import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AdminServiceIntegrationsService } from "./admin-service-integrations.service";
import { AdminCommonUserHubService } from "./admin-common-user-hub.service";
import { AdminAgencyLinksService } from "./admin-agency-links.service";
import { ServiceIntegrationActionSchema, CommonUserHubConfigUpdateSchema } from "./dto/admin-integrations.dto";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminAuthGuard, type AuthenticatedAdminRequest } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";

@ApiTags("admin-integrations")
@Controller("api/v1/admin")
export class AdminIntegrationsController {
  constructor(
    private readonly serviceIntegrations: AdminServiceIntegrationsService,
    private readonly commonUserHub: AdminCommonUserHubService,
    private readonly agencyLinks: AdminAgencyLinksService,
  ) {}

  @Get("service-integrations")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN", "AUDITOR")
  async listServiceIntegrations() {
    return this.serviceIntegrations.list();
  }

  /** 緊急停止 (指示書5章)。以後このサービスのAPIキーによる外部APIリクエストは即座に拒否される。 */
  @Post("service-integrations/:id/suspend")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN")
  async suspendServiceIntegration(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ServiceIntegrationActionSchema)) body: z.infer<typeof ServiceIntegrationActionSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.serviceIntegrations.suspend(id, req.admin.id, body.reason);
  }

  @Post("service-integrations/:id/reactivate")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN")
  async reactivateServiceIntegration(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ServiceIntegrationActionSchema)) body: z.infer<typeof ServiceIntegrationActionSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.serviceIntegrations.reactivate(id, req.admin.id, body.reason);
  }

  /**
   * APIキーの再発行。**生成した鍵は応答のこの1回しか取得できない**
   * (DBにはハッシュのみ保存する)。旧APIキーは即座に無効になる。
   *
   * 従来は `pnpm --filter @ove/database issue-service-integration --rotate` を
   * 本番DBに対して実行する必要があった。運用でサーバーを触らずに済むよう、
   * 同じ処理を管理画面から行えるようにしている。
   */
  @Post("service-integrations/:id/rotate-api-key")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN")
  async rotateServiceIntegrationApiKey(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ServiceIntegrationActionSchema)) body: z.infer<typeof ServiceIntegrationActionSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.serviceIntegrations.rotateApiKey(id, req.admin.id, body.reason);
  }

  /** HMAC署名シークレットの再発行。APIキーとは別に回せる。 */
  @Post("service-integrations/:id/rotate-signing-secret")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN")
  async rotateServiceIntegrationSigningSecret(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(ServiceIntegrationActionSchema)) body: z.infer<typeof ServiceIntegrationActionSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.serviceIntegrations.rotateSigningSecret(id, req.admin.id, body.reason);
  }

  /**
   * 代理店システム内共通顧客HUBへの送信設定 (外部開発者向け連携ガイド9章)。
   * APIキーの生値は返さない (末尾4文字のみのマスク表示)。
   */
  @Get("common-user-hub-config")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN", "AUDITOR")
  async getCommonUserHubConfig() {
    return this.commonUserHub.get();
  }

  /** baseUrl/systemKey/apiKeyのうち指定されたものだけを更新する (省略した項目は現状維持)。 */
  @Post("common-user-hub-config")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN")
  async updateCommonUserHubConfig(
    @Body(new ZodValidationPipe(CommonUserHubConfigUpdateSchema)) body: z.infer<typeof CommonUserHubConfigUpdateSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ) {
    return this.commonUserHub.update(
      { baseUrl: body.baseUrl, systemKey: body.systemKey, apiKey: body.apiKey },
      req.admin.id,
      body.reason,
    );
  }

  /**
   * 代理店連携状態一覧 (開発ガイドライン15章)。sengoku-ai.com代理店システムとの
   * account_links (PENDING=同期のみ受信/未紐付け、ACTIVE=SSOログイン済み) を確認する。
   * docs/agency-integration.md参照。
   */
  @Get("agency-links")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN", "AUDITOR")
  async listAgencyLinks(
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ): Promise<unknown> {
    return this.agencyLinks.list({ status, limit: limit ? Number(limit) : undefined });
  }

  @Get("agency-links/:id")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN", "AUDITOR")
  async agencyLinkDetail(@Param("id") id: string): Promise<unknown> {
    return this.agencyLinks.detail(id);
  }
}
