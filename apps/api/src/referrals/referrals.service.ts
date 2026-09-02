import { Injectable } from "@nestjs/common";
import { type OveAccount, type Prisma, type WalletReferral } from "@ove/database";
import { ReferralCaptureUseCase } from "./referral-capture.use-case";
import { AttachReferralToAccountUseCase, REFERRAL_SIGNUP_BONUS_AMOUNT } from "./attach-referral-to-account.use-case";
import { ConfirmReferralUseCase, type ConfirmReferralResult } from "./confirm-referral.use-case";
import { ReferralQueryService } from "./referral-query.service";

export { REFERRAL_SIGNUP_BONUS_AMOUNT };

/**
 * リファクタリング指示書 Phase 3: 旧`ReferralsService`はここまで縮小した
 * Facade。実装は`ReferralCaptureUseCase`・`AttachReferralToAccountUseCase`・
 * `ConfirmReferralUseCase`・`RejectReferralUseCase`・`ReferralQueryService`・
 * `ReferralRepository`へ分割済みで、このクラスは既存の呼び出し元
 * (auth.service.ts, wallets.controller.ts, common-event-handlers.service.ts,
 * accounts/common-user-linking.service.ts, referrals.controller.ts,
 * agency-referral-outbox-handler.ts) との互換性を保つためだけに
 * 同じpublicメソッドシグネチャで委譲する。
 */
@Injectable()
export class ReferralsService {
  constructor(
    private readonly capture_: ReferralCaptureUseCase,
    private readonly attach: AttachReferralToAccountUseCase,
    private readonly confirm: ConfirmReferralUseCase,
    private readonly query: ReferralQueryService,
  ) {}

  async capture(params: {
    rawToken: string;
    referralSessionKey?: string;
    agencyId?: string;
    source?: string;
    ipHash?: string;
    userAgentHash?: string;
  }): Promise<{ cookieToken: string; expiresAt: Date } | null> {
    return this.capture_.capture(params);
  }

  async resolvePendingSession(cookieToken: string | undefined): Promise<WalletReferral | null> {
    return this.capture_.resolvePendingSession(cookieToken);
  }

  async attachToNewAccount(
    tx: Prisma.TransactionClient,
    referral: WalletReferral,
    account: OveAccount,
    lineUserId: string,
  ): Promise<void> {
    return this.attach.attachToNewAccount(tx, referral, account, lineUserId);
  }

  async confirmBenefitFromEvent(params: {
    walletUserId?: string;
    referralSessionKey?: string;
    commonUserId?: string;
    eventId: string;
  }): Promise<ConfirmReferralResult> {
    return this.confirm.confirmBenefitFromEvent(params);
  }

  async confirmAfterCommonUserResolve(oveAccountId: string, commonUserId: string): Promise<void> {
    return this.confirm.confirmAfterCommonUserResolve(oveAccountId, commonUserId);
  }

  async retryConfirmViaOutbox(oveAccountId: string, commonUserId: string): Promise<void> {
    return this.confirm.retryConfirmViaOutbox(oveAccountId, commonUserId);
  }

  async getMyReferralStatus(oveAccountId: string) {
    return this.query.getMyReferralStatus(oveAccountId);
  }
}
