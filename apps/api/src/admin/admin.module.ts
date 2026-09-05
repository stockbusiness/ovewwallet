import { Module } from "@nestjs/common";
import { AccountsModule } from "../accounts/accounts.module";
import { CollectiblesModule } from "../collectibles/collectibles.module";
import { LineBroadcastService } from "../notices/line-broadcast.service";
import { AdminAccountMergeService } from "./admin-account-merge.service";
import { AdminAccountsController } from "./admin-accounts.controller";
import { AdminAgencyLinksService } from "./admin-agency-links.service";
import { AdminAgencySetupService } from "./admin-agency-setup.service";
import { AdminAgencyConnectionTestService } from "./admin-agency-connection-test.service";
import { IntegrationsModule } from "../integrations/integrations.module";
import { OutboxModule } from "../outbox/outbox.module";
import { AdminApprovalService } from "./admin-approval.service";
import { AdminApprovalsController } from "./admin-approvals.controller";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthService } from "./admin-auth.service";
import { AdminLoginThrottleService } from "./admin-login-throttle.service";
import { AdminBulkGrantService } from "./admin-bulk-grant.service";
import { AdminCollectiblesController } from "./admin-collectibles.controller";
import { AdminWalletReferralsService } from "./admin-wallet-referrals.service";
import { AdminNoticesService } from "./admin-notices.service";
import { AdminCommonUserHubService } from "./admin-common-user-hub.service";
import { AdminMailConfigService } from "./admin-mail-config.service";
import { AdminCollectiblesService } from "./admin-collectibles.service";
import { AdminIntegrationsController } from "./admin-integrations.controller";
import { AdminMigrationService } from "./admin-migration.service";
import { AdminMigrationsController } from "./admin-migrations.controller";
import { AdminNoticesController } from "./admin-notices.controller";
import { AdminReferralsController } from "./admin-referrals.controller";
import { AdminRewardRulesService } from "./admin-reward-rules.service";
import { AdminRewardsController } from "./admin-rewards.controller";
import { AdminServiceIntegrationsService } from "./admin-service-integrations.service";
import { AdminUsersController } from "./admin-users.controller";
import { AdminUsersService } from "./admin-users.service";
import { AdminWalletsController } from "./admin-wallets.controller";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";

@Module({
  // IntegrationsModule: 代理店システムへの接続テスト (AdminAgencyConnectionTestService) が
  // IntegrationHttpClient / IntegrationConfigProvider を使う。
  imports: [AccountsModule, CollectiblesModule, IntegrationsModule, OutboxModule],
  controllers: [
    AdminController,
    AdminAuthController,
    AdminAccountsController,
    AdminWalletsController,
    AdminRewardsController,
    AdminIntegrationsController,
    AdminReferralsController,
    AdminNoticesController,
    AdminMigrationsController,
    AdminApprovalsController,
    AdminCollectiblesController,
    AdminUsersController,
  ],
  providers: [
    AdminService,
    AdminAuthService,
    AdminLoginThrottleService,
    AdminBulkGrantService,
    AdminServiceIntegrationsService,
    AdminMigrationService,
    AdminAccountMergeService,
    AdminApprovalService,
    AdminRewardRulesService,
    AdminAgencyLinksService,
    AdminAgencySetupService,
    AdminAgencyConnectionTestService,
    AdminWalletReferralsService,
    AdminNoticesService,
    AdminCommonUserHubService,
    AdminMailConfigService,
    AdminCollectiblesService,
    AdminUsersService,
    LineBroadcastService,
  ],
  // AdminApprovalServiceは共通イベントハンドラ (common_user.merged) からも
  // システム起点のアカウント統合申請を作成するために参照する (二段階承認を再利用)。
  // AdminService・AdminRewardRulesServiceは`SchedulerModule`が定期実行から呼び出す
  // (整合性チェック・失効バッチ。手動実行と同じ処理を使うためロジックを複製しない)。
  exports: [AdminApprovalService, AdminService, AdminRewardRulesService],
})
export class AdminModule {}
