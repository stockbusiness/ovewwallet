import { Module } from "@nestjs/common";
import { ReferralsController } from "./referrals.controller";
import { ReferralsService } from "./referrals.service";
import { AgencyReferralClient } from "./agency-referral-client";
import { OutboxModule } from "../outbox/outbox.module";

@Module({
  imports: [OutboxModule],
  controllers: [ReferralsController],
  providers: [ReferralsService, AgencyReferralClient],
  exports: [ReferralsService],
})
export class ReferralsModule {}
