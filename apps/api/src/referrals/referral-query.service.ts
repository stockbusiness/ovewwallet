import { Injectable } from "@nestjs/common";
import { ReferralRepository } from "./referral.repository";

/**
 * リファクタリング指示書 Phase 3: `ReferralsService`から分離した、
 * ユーザー本人向けの紹介状況の参照責務 (更新は一切行わない)。
 */
@Injectable()
export class ReferralQueryService {
  constructor(private readonly referrals: ReferralRepository) {}

  async getMyReferralStatus(oveAccountId: string) {
    const benefit = await this.referrals.findBenefitByWalletUserId(oveAccountId);
    if (!benefit) return { referred: false as const };

    return {
      referred: true as const,
      status: benefit.status,
      amount: benefit.amount.toString(),
      confirmed_at: benefit.confirmedAt ? benefit.confirmedAt.toISOString() : null,
      reason: benefit.reason,
    };
  }
}
