import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { type PrismaClient } from "@ove/database";
import { reverseTransaction } from "@ove/ledger";
import { CommonEventBodySchema, type CommonEventBody } from "@ove/shared-types";
import { PRISMA } from "../../common/prisma.module";
import { isFeatureEnabled } from "../../common/feature-flags";
import { serializeTransaction } from "../../wallets/wallets.service";
import { getReversalOrchestratorSystemKeys } from "../common-event-handler-support";
import type { AuthenticatedEventContext, CommonEventHandler, CommonEventResult } from "../common-event-handler.interface";

/**
 * reward.reversed。対応する原取引は`sourceReferenceId`にmetadata.original_event_id
 * (無ければ本イベントのentitlement_id/order_id) を格納したCOMMON_EVENT_REWARD取引
 * として検索する。台帳の不変性を守るため、既存取引の変更ではなく`reverseTransaction`
 * によるREVERSAL取引の追加で取り消す。次期改修指示書P0-4: 原取引の送信元
 * (sourceService、付与時に認証済みsource_system_keyを記録済み) と本イベントの認証済み
 * 送信元が一致しない場合、`COMMON_EVENT_REVERSAL_ORCHESTRATOR_SYSTEM_KEYS`に明示的に
 * 登録された中央オーケストレーターでない限り拒否する
 * (他システムが作った付与を別システムから取消できないようにする)。
 */
@Injectable()
export class RewardReversedHandler implements CommonEventHandler {
  readonly eventType = "reward.reversed";
  readonly schema = CommonEventBodySchema;

  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async handle(context: AuthenticatedEventContext, body: CommonEventBody): Promise<CommonEventResult> {
    if (!isFeatureEnabled("ENABLE_EXTERNAL_REWARD_TYPES")) {
      return { action: "skipped", reason: "ENABLE_EXTERNAL_REWARD_TYPES is disabled" };
    }

    const metadata = (body.metadata as Record<string, unknown> | null | undefined) ?? {};
    const originalReference =
      (typeof metadata["original_event_id"] === "string" ? (metadata["original_event_id"] as string) : undefined) ??
      body.entitlement_id ??
      body.order_id;
    if (!originalReference) {
      throw new BadRequestException("metadata.original_event_id, entitlement_id, or order_id is required");
    }

    const original = await this.db.oveTransaction.findFirst({
      where: {
        transactionType: "COMMON_EVENT_REWARD",
        sourceReferenceId: originalReference,
        status: "COMPLETED",
      },
    });
    if (!original) {
      throw new NotFoundException(`no reversible COMMON_EVENT_REWARD transaction found for "${originalReference}"`);
    }

    const isSameSource = original.sourceService === context.authenticatedSourceSystemKey;
    const isOrchestrator = getReversalOrchestratorSystemKeys().has(context.authenticatedSourceSystemKey);
    if (!isSameSource && !isOrchestrator) {
      throw new ForbiddenException(
        `source_system_key "${context.authenticatedSourceSystemKey}" is not allowed to reverse a grant originally issued by "${original.sourceService}"`,
      );
    }

    const reversal = await reverseTransaction(
      {
        transactionId: original.id,
        reason: `reward.reversed (event_id=${body.event_id})`,
        idempotencyKey: `COMMON_EVENT_REWARD_REVERSAL:${body.event_id}`,
        createdByType: "EXTERNAL_SERVICE",
        createdById: context.authenticatedSourceSystemKey,
      },
      this.db,
    );

    return serializeTransaction(reversal);
  }
}
