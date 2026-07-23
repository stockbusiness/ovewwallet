import { BadRequestException, Injectable } from "@nestjs/common";
import { RewardReversedEventSchema, type CommonEventBody } from "@ove/shared-types";
import { isFeatureEnabled } from "../../common/feature-flags";
import { serializeTransaction } from "../../wallets/wallets.service";
import { ReverseRewardUseCase } from "../../rewards/reverse-reward.use-case";
import { getReversalOrchestratorSystemKeys } from "../common-event-handler-support";
import type { AuthenticatedEventContext, CommonEventHandler, CommonEventResult } from "../common-event-handler.interface";

/**
 * reward.reversed。対応する原取引は`sourceReferenceId`に正式フィールド
 * `original_event_id` (リファクタリング指示書 Phase 5、未指定の送信元向けには
 * `metadata.original_event_id`を後方互換fallbackとして参照、それも無ければ本イベントの
 * entitlement_id/order_id) を格納したCOMMON_EVENT_REWARD取引として検索する。
 * リファクタリング指示書 Phase 6により、原取引の検索・取消自体は`ReverseRewardUseCase`
 * (`GrantRewardUseCase`とは分離) に委譲する。次期改修指示書P0-4: 原取引の送信元
 * (sourceService、付与時に認証済みsource_system_keyを記録済み) と本イベントの認証済み
 * 送信元が一致しない場合、`COMMON_EVENT_REVERSAL_ORCHESTRATOR_SYSTEM_KEYS`に明示的に
 * 登録された中央オーケストレーターでない限り拒否する (他システムが作った付与を別
 * システムから取消できないようにする)。この認可判定は共通イベント固有のポリシーのため、
 * `ReverseRewardUseCase`の外側 (このハンドラ) で行う。
 */
@Injectable()
export class RewardReversedHandler implements CommonEventHandler {
  readonly eventType = "reward.reversed";
  readonly schema = RewardReversedEventSchema;

  constructor(private readonly reverseReward: ReverseRewardUseCase) {}

  async handle(context: AuthenticatedEventContext, body: CommonEventBody): Promise<CommonEventResult> {
    if (!isFeatureEnabled("ENABLE_EXTERNAL_REWARD_TYPES")) {
      return { action: "skipped", reason: "ENABLE_EXTERNAL_REWARD_TYPES is disabled" };
    }

    // 正式フィールドを優先し、未指定の送信元向けにmetadataを後方互換fallbackとして扱う。
    const metadata = (body.metadata as Record<string, unknown> | null | undefined) ?? {};
    const originalReference =
      body.original_event_id ??
      (typeof metadata["original_event_id"] === "string" ? (metadata["original_event_id"] as string) : undefined) ??
      body.entitlement_id ??
      body.order_id;
    if (!originalReference) {
      throw new BadRequestException("original_event_id, entitlement_id, or order_id is required");
    }

    const reversal = await this.reverseReward.execute({
      transactionType: "COMMON_EVENT_REWARD",
      originalReference,
      reason: `reward.reversed (event_id=${body.event_id})`,
      idempotencyKey: `COMMON_EVENT_REWARD_REVERSAL:${body.event_id}`,
      createdByType: "EXTERNAL_SERVICE",
      createdById: context.authenticatedSourceSystemKey,
      isAuthorized: (original) =>
        original.sourceService === context.authenticatedSourceSystemKey ||
        getReversalOrchestratorSystemKeys().has(context.authenticatedSourceSystemKey),
      unauthorizedMessage: (original) =>
        `source_system_key "${context.authenticatedSourceSystemKey}" is not allowed to reverse a grant originally issued by "${original.sourceService}"`,
    });

    return serializeTransaction(reversal);
  }
}
