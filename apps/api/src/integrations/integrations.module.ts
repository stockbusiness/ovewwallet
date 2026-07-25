import { Module } from "@nestjs/common";
import { IntegrationHttpClient } from "./integration-http-client";
import { IntegrationConfigProvider } from "./integration-config-provider";
import { CommonUserHubAdapter } from "./common-user-hub.adapter";
import { AgencyReferralAdapter } from "./agency-referral.adapter";
import { SengokuMarketClaimAdapter } from "./sengoku-market-claim.adapter";

/**
 * リファクタリング指示書 Phase 7「外部HTTP基盤」。新規に外部システムとの連携を
 * 追加する際、ここに追加するAdapterだけを増やせばよく、既存Adapter/呼び出し元の
 * 変更を必要としない (指示書2章「新しい外部システム・イベント追加時の修正範囲限定」)。
 */
@Module({
  providers: [
    IntegrationHttpClient,
    IntegrationConfigProvider,
    CommonUserHubAdapter,
    AgencyReferralAdapter,
    SengokuMarketClaimAdapter,
  ],
  exports: [
    IntegrationHttpClient,
    IntegrationConfigProvider,
    CommonUserHubAdapter,
    AgencyReferralAdapter,
    SengokuMarketClaimAdapter,
  ],
})
export class IntegrationsModule {}
