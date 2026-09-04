import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AdminServiceIntegrationsService } from "./admin-service-integrations.service";
import { AdminCommonUserHubService } from "./admin-common-user-hub.service";
import { AdminAgencyLinksService } from "./admin-agency-links.service";
import { AdminAgencySetupService } from "./admin-agency-setup.service";
import { AdminAgencyConnectionTestService } from "./admin-agency-connection-test.service";
import {
  AgencyLinkManualLinkSchema,
  AgencyLinkUnlinkSchema,
  ServiceIntegrationActionSchema,
  CommonUserHubConfigUpdateSchema,
} from "./dto/admin-integrations.dto";
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
    private readonly agencySetup: AdminAgencySetupService,
    private readonly agencyConnectionTest: AdminAgencyConnectionTestService,
  ) {}

  /**
   * 代理店連携の設定状況を1回でまとめて返す (セットアップ画面用)。
   * 設定変更は行わず、状態を読むだけ。AUDITORにも開放している。
   */
  @Get("agency-setup")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN", "AUDITOR")
  async getAgencySetup() {
    return this.agencySetup.get();
  }

  /**
   * 代理店システムへの疎通と認証だけを確かめる。Feature Flagを開ける**前**に
   * 設定の正しさを確認できるよう、Flagは見ない。副作用を避けるため
   * `create_if_missing: false` で問い合わせる (相手側に何も作らない)。
   *
   * 本番の認証情報で外部へ発信するため AUDITOR には開放しない。
   */
  @Post("agency-setup/test-connection")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN")
  async testAgencyConnection(@Req() req: AuthenticatedAdminRequest) {
    return this.agencyConnectionTest.run(req.admin.id);
  }

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

  /**
   * 代理店の担当者とORIアカウントを手動で紐付ける。通常はSSOログインが作る紐付けだが、
   * SSOが未接続の間や、担当者がLINEログインで先にウォレットを作った場合に
   * 同期のみの`PENDING`が残り、その担当者宛の付与が404になり続けるため
   * (`docs/integration/AGENCY_POINT_AWARD.md` 4章)。
   *
   * 残高の行き先を決める操作なので、閲覧専用のAUDITORには開けない。
   */
  @Post("agency-links/:id/link")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN")
  async linkAgencyLink(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AgencyLinkManualLinkSchema)) body: z.infer<typeof AgencyLinkManualLinkSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ): Promise<unknown> {
    return this.agencyLinks.linkManually({
      id,
      account: body.account,
      adminId: req.admin.id,
      reason: body.reason,
    });
  }

  @Post("agency-links/:id/unlink")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "INTEGRATION_ADMIN")
  async unlinkAgencyLink(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(AgencyLinkUnlinkSchema)) body: z.infer<typeof AgencyLinkUnlinkSchema>,
    @Req() req: AuthenticatedAdminRequest,
  ): Promise<unknown> {
    return this.agencyLinks.unlink({ id, adminId: req.admin.id, reason: body.reason });
  }
}
