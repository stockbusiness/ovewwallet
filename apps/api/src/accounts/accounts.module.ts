import { Module } from "@nestjs/common";
import { CommonUserHubModule } from "../common-user-hub/common-user-hub.module";
import { ReferralsModule } from "../referrals/referrals.module";
import { RewardsModule } from "../rewards/rewards.module";
import { AccountAnonymizationService } from "./account-anonymization.service";
import { AccountClosureService } from "./account-closure.service";
import { AccountProfileService } from "./account-profile.service";
import { AccountRegistrationService } from "./account-registration.service";
import { AccountsController } from "./accounts.controller";
import { AccountsService } from "./accounts.service";
import { CommonUserLinkingService } from "./common-user-linking.service";
import { SessionManagementService } from "./session-management.service";
import { TermsConsentService } from "./terms-consent.service";

@Module({
  imports: [CommonUserHubModule, ReferralsModule, RewardsModule],
  controllers: [AccountsController],
  providers: [
    AccountsService,
    AccountRegistrationService,
    CommonUserLinkingService,
    SessionManagementService,
    AccountClosureService,
    AccountAnonymizationService,
    TermsConsentService,
    AccountProfileService,
  ],
  // 管理画面の「共通IDを再解決」(AdminCommonUserResolveService) から使う。
  exports: [AccountsService, AccountAnonymizationService, AccountProfileService, CommonUserLinkingService],
})
export class AccountsModule {}
