import { Injectable, Logger } from "@nestjs/common";
import { generateId, type OveAccount, type Prisma, type WalletReferral } from "@ove/database";
import { decryptSecret, sha256Hex } from "@ove/auth";
import { getEncryptionKey } from "../common/encryption-key";
import { OutboxService } from "../outbox/outbox.service";
import { ReferralRepository } from "./referral.repository";

export const REFERRAL_SIGNUP_BONUS_AMOUNT = BigInt(process.env.REFERRAL_SIGNUP_BONUS_AMOUNT || "3000");

/**
 * リファクタリング指示書 Phase 3: `ReferralsService`から分離した、新規アカウント
 * 作成時に紹介関係を紐付ける責務。
 */
@Injectable()
export class AttachReferralToAccountUseCase {
  private readonly logger = new Logger(AttachReferralToAccountUseCase.name);

  constructor(
    private readonly referrals: ReferralRepository,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * 新規アカウント作成と同一トランザクション内で呼ぶ (`AccountRegistrationService.onNewAccountCreated`)。
   * 紹介関係をPENDINGへ、初回登録特典をPENDINGで作成し、代理店システムへの同期を
   * outboxへ登録する (実際の送信はPhase 2でAgencyReferralClientを実装してから)。
   */
  async attachToNewAccount(
    tx: Prisma.TransactionClient,
    referral: WalletReferral,
    account: OveAccount,
    lineUserId: string,
  ): Promise<void> {
    const now = new Date();

    // resolvePendingSession()での確認からここまでの間に別リクエストが同じ紹介セッションを
    // 先に消費している可能性があるため (同一Cookieでの並行リクエストなど)、
    // status: "CAPTURED" / usedAt: null を条件に含めた条件付き更新で排他する (状態遷移は
    // `ReferralRepository.claimCapturedForAccount`が担当、CAPTURED→PENDINGのみ許可)。
    // 影響行数が0件の場合はこのリクエスト側が競合に負けたということなので、
    // 特典付与・outbox登録は行わず、通常の(紹介なし)新規登録として処理を継続する
    // (実装指示書17.2章の「無効なトークンでも登録は継続する」と同じ方針)。
    const claimed = await this.referrals.claimCapturedForAccount(tx, referral.id, account.id, now);
    if (claimed.count === 0) {
      this.logger.warn("referral attach: lost race to a concurrent request, skipping benefit/outbox");
      return;
    }

    await this.referrals.createBenefit(
      {
        id: generateId(),
        walletUserId: account.id,
        lineUserIdHash: sha256Hex(lineUserId),
        referralId: referral.id,
        benefitType: "REFERRAL_SIGNUP_BONUS",
        amount: REFERRAL_SIGNUP_BONUS_AMOUNT,
        status: "PENDING",
        idempotencyKey: `REFERRAL_SIGNUP_BONUS:${account.id}`,
      },
      tx,
    );

    const referralTokenPlain = decryptSecret(referral.referralTokenEncrypted, getEncryptionKey());
    await this.outbox.enqueue(tx, {
      eventType: "wallet.referral.registered",
      aggregateType: "wallet_referral",
      aggregateId: referral.id,
      destinationService: "AGENCY_SYSTEM",
      idempotencyKey: `WALLET_REFERRAL_REGISTERED:${referral.id}`,
      payload: {
        request_id: generateId(),
        event_type: "wallet.referral.registered",
        common_user_id: referral.commonUserId,
        wallet_user_id: account.id,
        referral_token: referralTokenPlain,
        referred_at: referral.capturedAt.toISOString(),
        registration_completed_at: now.toISOString(),
        line_verified: true,
        source: "ove_wallet",
      },
    });
  }
}
