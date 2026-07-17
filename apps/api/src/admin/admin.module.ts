import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { AdminAuthService } from "./admin-auth.service";
import { AdminBulkGrantService } from "./admin-bulk-grant.service";
import { AdminServiceIntegrationsService } from "./admin-service-integrations.service";
import { AdminMigrationService } from "./admin-migration.service";
import { AdminAccountMergeService } from "./admin-account-merge.service";
import { AdminApprovalService } from "./admin-approval.service";
import { AdminRewardRulesService } from "./admin-reward-rules.service";
import { AdminAgencyLinksService } from "./admin-agency-links.service";
import { AdminWalletReferralsService } from "./admin-wallet-referrals.service";
import { AccountsModule } from "../accounts/accounts.module";

@Module({
  imports: [AccountsModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminAuthService,
    AdminBulkGrantService,
    AdminServiceIntegrationsService,
    AdminMigrationService,
    AdminAccountMergeService,
    AdminApprovalService,
    AdminRewardRulesService,
    AdminAgencyLinksService,
    AdminWalletReferralsService,
  ],
})
export class AdminModule {}
