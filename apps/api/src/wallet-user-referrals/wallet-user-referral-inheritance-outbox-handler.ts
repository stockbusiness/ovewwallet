import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { AgencyReferralInheritanceAdapter } from "../integrations/agency-referral-inheritance.adapter";
import type { OutboxDestinationHandler, OutboxEvent } from "../outbox/outbox.service";

/** Outboxに積んだ申請ペイロード。登録時に確定した値をそのまま送る。 */
interface InheritanceRequestPayload {
  event_id?: unknown;
  referrer_common_user_id?: unknown;
  referred_common_user_id?: unknown;
  referred_at?: unknown;
  referral_record_id?: unknown;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`inheritance request payload is missing "${field}"`);
  }
  return value;
}

/**
 * `wallet.referral.inheritance.requested` の送信ハンドラ
 * (`docs/wallet-user-referral.md` Phase 2)。
 *
 * 同じ `destinationService: "AGENCY_SYSTEM"` には既に
 * `AgencyReferralOutboxHandler` (`wallet.referral.registered`用) が登録されている
 * ため、`OutboxService.registerEventHandler` でevent_type単位に登録する。
 *
 * `AgencyReferralOutboxHandler`と違い、**登録当時のペイロードをそのまま送る**。
 * 先方は `event_id` が再送時も同じであることを前提に重複を見ているので、
 * 送信時点のDBから作り直すと値が揺れうる。紹介記録が後から消えることも無い
 * (`id`は外部公開IDとして不変)。
 */
@Injectable()
export class WalletUserReferralInheritanceOutboxHandler implements OutboxDestinationHandler {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly inheritance: AgencyReferralInheritanceAdapter,
  ) {}

  async send(event: OutboxEvent): Promise<void> {
    if (event.eventType !== "wallet.referral.inheritance.requested") {
      throw new Error(
        `WalletUserReferralInheritanceOutboxHandler: unsupported event_type "${event.eventType}"`,
      );
    }

    const referral = await this.db.walletUserReferral.findUnique({ where: { id: event.aggregateId } });
    // 紹介記録が無い (手動削除等) なら送る相手が特定できない。再送しても直らない
    // ため成功として扱い、Outboxに滞留させない。
    if (!referral) return;

    const payload = (event.payload ?? {}) as InheritanceRequestPayload;
    await this.inheritance.requestInheritance({
      eventId: requireString(payload.event_id, "event_id"),
      referrerCommonUserId: requireString(payload.referrer_common_user_id, "referrer_common_user_id"),
      referredCommonUserId: requireString(payload.referred_common_user_id, "referred_common_user_id"),
      referredAt: requireString(payload.referred_at, "referred_at"),
      referralRecordId: requireString(payload.referral_record_id, "referral_record_id"),
    });
  }
}
