import { Module, type OnModuleInit } from "@nestjs/common";
import { ReferralsController } from "./referrals.controller";
import { ReferralsService } from "./referrals.service";
import { ReferralRepository } from "./referral.repository";
import { ReferralCaptureUseCase } from "./referral-capture.use-case";
import { AttachReferralToAccountUseCase } from "./attach-referral-to-account.use-case";
import { ConfirmReferralUseCase } from "./confirm-referral.use-case";
import { RejectReferralUseCase } from "./reject-referral.use-case";
import { ReferralQueryService } from "./referral-query.service";
import { AgencyReferralClient } from "./agency-referral-client";
import { AgencyReferralOutboxHandler } from "./agency-referral-outbox-handler";
import { OutboxModule } from "../outbox/outbox.module";
import { OutboxService } from "../outbox/outbox.service";
import { IntegrationsModule } from "../integrations/integrations.module";

@Module({
  imports: [OutboxModule, IntegrationsModule],
  controllers: [ReferralsController],
  providers: [
    ReferralsService,
    ReferralRepository,
    ReferralCaptureUseCase,
    AttachReferralToAccountUseCase,
    ConfirmReferralUseCase,
    RejectReferralUseCase,
    ReferralQueryService,
    AgencyReferralClient,
    AgencyReferralOutboxHandler,
  ],
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
