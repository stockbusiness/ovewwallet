import { Module } from "@nestjs/common";
import { CommonEventsController } from "./common-events.controller";
import { CommonEventSigningKeysController } from "./common-event-signing-keys.controller";
import { CommonEventAuthGuard } from "./common-event-auth.guard";
import { CommonEventSigningKeysService } from "./common-event-signing-keys.service";
import { InboundEventsService } from "./inbound-events.service";
import { CommonEventHandlersService } from "./common-event-handlers.service";
import { CommonEventHandlerRegistry } from "./common-event-handler-registry";
import { CommonEventAccountResolver } from "./common-event-account-resolver";
import { CommonUserResolvedHandler } from "./handlers/common-user-resolved.handler";
import { CommonUserMergedHandler } from "./handlers/common-user-merged.handler";
import { CustomerAssignmentChangedHandler } from "./handlers/customer-assignment-changed.handler";
import { ReferralConfirmedHandler } from "./handlers/referral-confirmed.handler";
import { RewardGrantedHandler } from "./handlers/reward-granted.handler";
import { RewardReversedHandler } from "./handlers/reward-reversed.handler";
import { AdminModule } from "../admin/admin.module";
import { ReferralsModule } from "../referrals/referrals.module";

/**
 * 千ノ国 全体統合 共通実装契約 v1.0 6章「共通イベント契約」の受信側実装。
 * 送信専用のOutboxModuleとは独立した、受信専用(Inbox)モジュール。
 */
@Module({
  imports: [AdminModule, ReferralsModule],
  controllers: [CommonEventsController, CommonEventSigningKeysController],
  providers: [
    CommonEventAuthGuard,
    CommonEventSigningKeysService,
    InboundEventsService,
    CommonEventHandlersService,
    CommonEventHandlerRegistry,
    CommonEventAccountResolver,
    CommonUserResolvedHandler,
    CommonUserMergedHandler,
    CustomerAssignmentChangedHandler,
    ReferralConfirmedHandler,
    RewardGrantedHandler,
    RewardReversedHandler,
  ],
  exports: [CommonEventSigningKeysService],
})
export class CommonEventsModule {}
