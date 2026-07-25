import { Injectable } from "@nestjs/common";
import { ReferralConfirmedEventSchema, type CommonEventBody } from "@ove/shared-types";
import { ReferralsService } from "../../referrals/referrals.service";
import type { AuthenticatedEventContext, CommonEventHandler, CommonEventResult } from "../common-event-handler.interface";

/** referral.confirmed。`ReferralsService.confirmBenefitFromEvent`へ委譲する (紹介Phase 2)。 */
@Injectable()
export class ReferralConfirmedHandler implements CommonEventHandler {
  readonly eventType = "referral.confirmed";
  readonly schema = ReferralConfirmedEventSchema;

  constructor(private readonly referrals: ReferralsService) {}

  async handle(_context: AuthenticatedEventContext, body: CommonEventBody): Promise<CommonEventResult> {
    const result = await this.referrals.confirmBenefitFromEvent({
      referralSessionKey: body.referral_session_key ?? undefined,
      commonUserId: body.common_user_id ?? undefined,
      eventId: body.event_id,
    });
    return { ...result };
  }
}
