import { Module, type OnModuleInit } from "@nestjs/common";
import { ReferralsController } from "./referrals.controller";
import { ReferralsService } from "./referrals.service";
import { AgencyReferralClient } from "./agency-referral-client";
import { AgencyReferralOutboxHandler } from "./agency-referral-outbox-handler";
import { OutboxModule } from "../outbox/outbox.module";
import { OutboxService } from "../outbox/outbox.service";

@Module({
  imports: [OutboxModule],
  controllers: [ReferralsController],
  providers: [ReferralsService, AgencyReferralClient, AgencyReferralOutboxHandler],
  exports: [ReferralsService],
})
export class ReferralsModule implements OnModuleInit {
  constructor(
    private readonly outbox: OutboxService,
    private readonly agencyReferralOutboxHandler: AgencyReferralOutboxHandler,
  ) {}

  /**
   * `wallet.referral.registered`イベント (destinationService: "AGENCY_SYSTEM") の
   * 送信ハンドラを登録する。登録するだけで実送信していなかった不備
   * (全システム横断連携分析 H章シナリオ#12) の解消。
   */
  onModuleInit(): void {
    this.outbox.registerDestination("AGENCY_SYSTEM", this.agencyReferralOutboxHandler);
  }
}
