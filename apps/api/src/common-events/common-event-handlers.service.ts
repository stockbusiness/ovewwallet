import {
  BadRequestException,
  Injectable,
  Logger,
  type OnModuleInit,
} from "@nestjs/common";
import type { CommonEventBody } from "@ove/shared-types";
import { CommonEventHandlerRegistry } from "./common-event-handler-registry";
import { CommonUserMergedHandler } from "./handlers/common-user-merged.handler";
import { CommonUserResolvedHandler } from "./handlers/common-user-resolved.handler";
import { CustomerAssignmentChangedHandler } from "./handlers/customer-assignment-changed.handler";
import { EntitlementGrantedHandler } from "./handlers/entitlement-granted.handler";
import { EntitlementRevokedHandler } from "./handlers/entitlement-revoked.handler";
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
  private readonly logger = new Logger(CommonEventHandlersService.name);

  constructor(
    private readonly registry: CommonEventHandlerRegistry,
    private readonly commonUserResolved: CommonUserResolvedHandler,
    private readonly commonUserMerged: CommonUserMergedHandler,
    private readonly customerAssignmentChanged: CustomerAssignmentChangedHandler,
    private readonly referralConfirmed: ReferralConfirmedHandler,
    private readonly rewardGranted: RewardGrantedHandler,
    private readonly rewardReversed: RewardReversedHandler,
    private readonly entitlementGranted: EntitlementGrantedHandler,
    private readonly entitlementRevoked: EntitlementRevokedHandler,
  ) {}

  /** 同一event_typeの二重登録はここで即座に起動失敗させる (指示書Phase 4受入条件)。 */
  onModuleInit(): void {
    this.registry.register(this.commonUserResolved);
    this.registry.register(this.commonUserMerged);
    this.registry.register(this.customerAssignmentChanged);
    this.registry.register(this.referralConfirmed);
    this.registry.register(this.rewardGranted);
    this.registry.register(this.rewardReversed);
    this.registry.register(this.entitlementGranted);
    this.registry.register(this.entitlementRevoked);
  }

  async dispatch(
    eventType: string,
    body: CommonEventBody,
    authenticatedSourceSystemKey: string,
    requestId?: string,
  ): Promise<unknown> {
    const handler = this.registry.resolve(eventType);
    if (!handler) {
      // PR-W3-a: ack-onlyで受理したことを、payload本文・PIIを含めずに記録する
      // (source_system_key/event_type/event_version/event_id/request_idのみ)。
      this.logger.log(
        `ack-only: source_system_key=${authenticatedSourceSystemKey} event_type=${eventType} ` +
          `event_version=${body.event_version} event_id=${body.event_id} request_id=${requestId ?? "-"}`,
      );
      return {
        note: `no handler registered for event_type "${eventType}"; recorded only`,
      };
    }

    // リファクタリング指示書 Phase 5: Phase 4で導入したevent_type別`schema`を実際の
    // 検証に使う。コントローラの`CommonEventBodySchema`(全event_type共通・全項目任意) を
    // 通過した後の、ハンドラごとのより厳密な型チェックとして機能する。
    const parseResult = handler.schema.safeParse(body);
    if (!parseResult.success) {
      const issues = parseResult.error.errors
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new BadRequestException(
        `event_type "${eventType}" payload failed schema validation: ${issues}`,
      );
    }

    return handler.handle(
      { eventId: body.event_id, eventType, authenticatedSourceSystemKey },
      parseResult.data,
    );
  }
}
