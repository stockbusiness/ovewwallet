import { Injectable } from "@nestjs/common";
import { type WalletReferral } from "@ove/database";
import { ReferralRepository } from "./referral.repository";
import { assertValidReferralTransition } from "./referral-state-machine";

/**
 * リファクタリング指示書 Phase 3: `ReferralsService`から分離した紹介関係の
 * 否認処理 (代理店システムがトークン無効・期限切れ・対象外と判定した場合)。
 */
@Injectable()
export class RejectReferralUseCase {
  constructor(private readonly referrals: ReferralRepository) {}

  async reject(referral: WalletReferral, errorCode: string): Promise<WalletReferral> {
    assertValidReferralTransition(referral.status, "REJECTED");
    return this.referrals.update(referral.id, {
      status: "REJECTED",
      rejectedAt: new Date(),
      lastErrorCode: errorCode,
    });
  }
}
