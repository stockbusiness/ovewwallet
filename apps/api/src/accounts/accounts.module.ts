import { Module } from "@nestjs/common";
import { CommonUserHubModule } from "../common-user-hub/common-user-hub.module";
import { ReferralsModule } from "../referrals/referrals.module";
import { AccountAnonymizationService } from "./account-anonymization.service";
import { AccountClosureService } from "./account-closure.service";
import { AccountRegistrationService } from "./account-registration.service";
import { AccountsController } from "./accounts.controller";
import { AccountsService } from "./accounts.service";
import { CommonUserLinkingService } from "./common-user-linking.service";
import { SessionManagementService } from "./session-management.service";
import { TermsConsentService } from "./terms-consent.service";

@Module({
  imports: [CommonUserHubModule, ReferralsModule],
  controllers: [AccountsController],
  providers: [
    AccountsService,
    AccountRegistrationService,
    CommonUserLinkingService,
    SessionManagementService,
    AccountClosureService,
    AccountAnonymizationService,
    TermsConsentService,
  ],
  exports: [AccountsService, AccountAnonymizationService],
})
export class AccountsModule {}
