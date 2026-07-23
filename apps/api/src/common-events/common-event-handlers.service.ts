import { Injectable, type OnModuleInit } from "@nestjs/common";
import type { CommonEventBody } from "@ove/shared-types";
import { CommonEventHandlerRegistry } from "./common-event-handler-registry";
import { CommonUserResolvedHandler } from "./handlers/common-user-resolved.handler";
import { CommonUserMergedHandler } from "./handlers/common-user-merged.handler";
import { CustomerAssignmentChangedHandler } from "./handlers/customer-assignment-changed.handler";
import { ReferralConfirmedHandler } from "./handlers/referral-confirmed.handler";
import { RewardGrantedHandler } from "./handlers/reward-granted.handler";
import { RewardReversedHandler } from "./handlers/reward-reversed.handler";

/**
 * リファクタリング指示書 Phase 4: 千ノ国 全体統合 共通実装契約 v1.0 6.2章のうち、
 * ウォレットが実際に反応するイベント種別の実体は`handlers/*.handler.ts`へ分割済み。
 * このクラスは`InboundEventsService`からの唯一の窓口 (Facade) として、
 * `CommonEventHandlerRegistry`でevent_typeからハンドラを解決して委譲するだけに
 * 縮小した。契約6.2章の必須イベントのうちウォレットが反応しないもの
 * (order系・payment系・entitlement系等、正本は他システム) は未登録のままにし、
 * 受信自体は成功として扱う (200、送信元のOutboxを詰まらせない、監査目的で記録のみ)。
 */
@Injectable()
export class CommonEventHandlersService implements OnModuleInit {
  constructor(
    private readonly registry: CommonEventHandlerRegistry,
    private readonly commonUserResolved: CommonUserResolvedHandler,
    private readonly commonUserMerged: CommonUserMergedHandler,
    private readonly customerAssignmentChanged: CustomerAssignmentChangedHandler,
    private readonly referralConfirmed: ReferralConfirmedHandler,
    private readonly rewardGranted: RewardGrantedHandler,
    private readonly rewardReversed: RewardReversedHandler,
  ) {}

  /** 同一event_typeの二重登録はここで即座に起動失敗させる (指示書Phase 4受入条件)。 */
  onModuleInit(): void {
    this.registry.register(this.commonUserResolved);
    this.registry.register(this.commonUserMerged);
    this.registry.register(this.customerAssignmentChanged);
    this.registry.register(this.referralConfirmed);
    this.registry.register(this.rewardGranted);
    this.registry.register(this.rewardReversed);
  }

  async dispatch(eventType: string, body: CommonEventBody, authenticatedSourceSystemKey: string): Promise<unknown> {
    const handler = this.registry.resolve(eventType);
    if (!handler) {
      return { note: `no handler registered for event_type "${eventType}"; recorded only` };
    }
    return handler.handle({ eventId: body.event_id, eventType, authenticatedSourceSystemKey }, body);
  }
}
