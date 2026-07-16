import { Body, Controller, Post, Req, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AgencySyncRequestSchema, type AgencySyncRequest } from "@ove/shared-types";
import { AgencyService } from "./agency.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AgencyApiKeyGuard, type AuthenticatedPartnerRequest } from "../common/agency-api-key.guard";
import { isFeatureEnabled } from "../common/feature-flags";

/**
 * 戦国経済圏代理店システム外部連携API仕様書 v3.6.71。
 * パスは仕様書7.1章の「ドメインだけ登録した場合に自動付与されるパス」と
 * 完全一致させる(バージョンプレフィックスなし)。
 * 開発ガイドライン13章の方針により、`ENABLE_AGENCY_REFERRAL_SYNC` (既定false)
 * で段階的に有効化する。
 */
@ApiTags("agency-integration")
@Controller("api/integrations/agencies")
export class AgencyController {
  constructor(private readonly agency: AgencyService) {}

  @Post()
  @UseGuards(AgencyApiKeyGuard)
  async sync(
    @Body(new ZodValidationPipe(AgencySyncRequestSchema)) body: AgencySyncRequest,
    @Req() req: AuthenticatedPartnerRequest,
  ) {
    if (!isFeatureEnabled("ENABLE_AGENCY_REFERRAL_SYNC")) {
      throw new ServiceUnavailableException("agency integration is not enabled yet");
    }

    // 接続テスト(13章)は本登録せず、認証とJSON受信のみ確認して2xxを返す。
    if (body.event === "connection_test" || body.dry_run) {
      return { success: true, message: "connection ok" };
    }

    const result = await this.agency.syncAgency(req.serviceIntegration.id, body);
    return { success: true, data: { external_id: result.externalId, synced: result.synced } };
  }
}
