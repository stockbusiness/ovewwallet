import { Module } from "@nestjs/common";
import { AdminModule } from "../admin/admin.module";
import { CollectiblesModule } from "../collectibles/collectibles.module";
import { ReferralsModule } from "../referrals/referrals.module";
import { RewardsModule } from "../rewards/rewards.module";
import { AgencyAssignmentRepository } from "./agency-assignment.repository";
import { CommonEventAccountResolver } from "./common-event-account-resolver";
import { CommonEventAuthGuard } from "./common-event-auth.guard";
import { CommonEventHandlerRegistry } from "./common-event-handler-registry";
import { CommonEventHandlersService } from "./common-event-handlers.service";
import { CommonEventSigningKeysController } from "./common-event-signing-keys.controller";
import { CommonEventsController } from "./common-events.controller";
import { CommonEventSigningKeysService } from "./common-event-signing-keys.service";
import { CommonUserResolvedHandler } from "./handlers/common-user-resolved.handler";
import { InboundEventRepository } from "./inbound-event.repository";
import { InboundEventsService } from "./inbound-events.service";
import { CommonUserMergedHandler } from "./handlers/common-user-merged.handler";
import { CustomerAssignmentChangedHandler } from "./handlers/customer-assignment-changed.handler";
import { ReferralConfirmedHandler } from "./handlers/referral-confirmed.handler";
import { RewardGrantedHandler } from "./handlers/reward-granted.handler";
import { RewardReversedHandler } from "./handlers/reward-reversed.handler";
import { EntitlementGrantedHandler } from "./handlers/entitlement-granted.handler";
import { EntitlementRevokedHandler } from "./handlers/entitlement-revoked.handler";

/**
 * 千ノ国 全体統合 共通実装契約 v1.0 6章「共通イベント契約」の受信側実装。
 * 送信専用のOutboxModuleとは独立した、受信専用(Inbox)モジュール。
 */
@Module({
  imports: [AdminModule, ReferralsModule, RewardsModule, CollectiblesModule],
  controllers: [CommonEventsController, CommonEventSigningKeysController],
  providers: [
    CommonEventAuthGuard,
    CommonEventSigningKeysService,
    InboundEventsService,
    InboundEventRepository,
    CommonEventHandlersService,
    CommonEventHandlerRegistry,
    CommonEventAccountResolver,
    AgencyAssignmentRepository,
    CommonUserResolvedHandler,
    CommonUserMergedHandler,
    CustomerAssignmentChangedHandler,
    ReferralConfirmedHandler,
    RewardGrantedHandler,
    RewardReversedHandler,
    EntitlementGrantedHandler,
    EntitlementRevokedHandler,
  ],
  exports: [CommonEventSigningKeysService],
})
export class CommonEventsModule {}
