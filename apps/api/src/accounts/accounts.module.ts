import { Module } from "@nestjs/common";
import { AccountsController } from "./accounts.controller";
import { AccountsService } from "./accounts.service";
import { AccountRegistrationService } from "./account-registration.service";
import { ExternalAccountProvisioningService } from "./external-account-provisioning.service";
import { CommonUserLinkingService } from "./common-user-linking.service";
import { SessionManagementService } from "./session-management.service";
import { AccountClosureService } from "./account-closure.service";
import { CommonUserHubModule } from "../common-user-hub/common-user-hub.module";
import { ReferralsModule } from "../referrals/referrals.module";

@Module({
  imports: [CommonUserHubModule, ReferralsModule],
  controllers: [AccountsController],
  providers: [
    AccountsService,
    AccountRegistrationService,
    ExternalAccountProvisioningService,
    CommonUserLinkingService,
    SessionManagementService,
    AccountClosureService,
  ],
  exports: [AccountsService],
})
export class AccountsModule {}
