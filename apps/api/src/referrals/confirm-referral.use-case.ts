import { Inject, Injectable } from "@nestjs/common";
import { type PrismaClient, type WalletReferral } from "@ove/database";
import { decryptSecret } from "@ove/auth";
import { creditWalletInTransaction, lockWallet } from "@ove/ledger";
import { PRISMA } from "../common/prisma.module";
import { getEncryptionKey } from "../common/encryption-key";
import { AgencyReferralClient } from "./agency-referral-client";
import { ReferralRepository } from "./referral.repository";
import { RejectReferralUseCase } from "./reject-referral.use-case";
import { assertValidReferralTransition } from "./referral-state-machine";

export interface ConfirmReferralResult {
  action: string;
  referral_id?: string;
  transaction_id?: string;
  benefit_status?: string;
}

/**
 * リファクタリング指示書 Phase 3: `ReferralsService`から分離した紹介特典の
 * 確定処理。§9原子性: CREDIT・`wallet_referral_benefits`確定・`wallet_referrals`確定を
 * 1つのDBトランザクションにまとめる (旧実装は3つの別々の呼び出しに分かれており、
 * CREDIT成功後に状態更新が失敗すると「特典は付与済みなのにPENDINGのまま」という
 * 不整合が起こり得た)。
 */
@Injectable()
export class ConfirmReferralUseCase {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly referrals: ReferralRepository,
    private readonly agencyClient: AgencyReferralClient,
    private readonly rejectReferral: RejectReferralUseCase,
  ) {}

  /**
   * 紹介Phase 2: 代理店システムからの`referral.confirmed`イベント (共通実装契約6.2章)
   * を受けて、PENDINGの紹介関係と登録特典を確定する。既存台帳の不変性を壊さないため、
   * PENDINGのWalletReferralBenefitはそのまま承認記録として残し、確定は新規CREDIT取引
   * (`REFERRAL_REWARD`) を追加することで表現する
   * (`docs/integration/AGENCY_REFERRAL_PHASE2_PLAN.md`の設計方針)。
   */
  async confirmBenefitFromEvent(params: {
    /** 呼び出し元がOVEアカウントを既に確定している場合 (`confirmAfterCommonUserResolve`
     * 等) はこちらを優先する。`walletUserId`にはDB上の一意制約があるため、
     * `referralSessionKey`のような外部由来の値と違い曖昧さが無い。 */
    walletUserId?: string;
    referralSessionKey?: string;
    commonUserId?: string;
    eventId: string;
  }): Promise<ConfirmReferralResult> {
    let referral: WalletReferral | null = null;
    if (params.walletUserId) {
      referral = await this.referrals.findByWalletUserId(params.walletUserId);
    }
    if (!referral && params.referralSessionKey) {
      referral = await this.referrals.findFirstByReferralSessionKey(params.referralSessionKey);
    }
    if (!referral && params.commonUserId) {
      // common_user_idはUNIQUE制約が無いため、2件以上ヒットした場合はどちらのアカウントの
      // 紹介関係か一意に決められない。自動処理せず対象外として扱う
      // (次期改修指示書P0-5、確定は要レビュー — referralSessionKeyでの再送に委ねる)。
      const accounts = await this.db.oveAccount.findMany({ where: { commonUserId: params.commonUserId } });
      if (accounts.length === 1) {
        referral = await this.referrals.findByWalletUserId(accounts[0]!.id);
      } else if (accounts.length > 1) {
        return { action: "common_user_id_conflict" };
      }
    }
    if (!referral) return { action: "no_local_referral" };

    // 高速パス: 明らかに対象外の場合はトランザクションを開かずに即座に返す
    // (真の排他は下のトランザクション内の再確認で保証する)。
    if (referral.status === "CONFIRMED" || referral.status === "MANUALLY_CONFIRMED") {
      return { action: "already_confirmed", referral_id: referral.id };
    }
    if (referral.status !== "PENDING" || !referral.walletUserId) {
      return { action: "not_pending", referral_id: referral.id };
    }

    const referralId = referral.id;
    const walletUserId = referral.walletUserId;

    return this.db.$transaction(async (tx) => {
      // ウォレット行をSELECT...FOR UPDATEでロックしてから状態を再取得することで、
      // 同一紹介関係への並行confirmを直列化する (TOCTOUレースを閉じる。
      // 台帳全体で使っている行ロックによる直列化と同じ方式)。
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { oveAccountId: walletUserId } });
      await lockWallet(tx, wallet.id);

      const referralInTx = await this.referrals.findByIdOrThrow(referralId, tx);
      if (referralInTx.status === "CONFIRMED" || referralInTx.status === "MANUALLY_CONFIRMED") {
        return { action: "already_confirmed", referral_id: referralInTx.id };
      }
      if (referralInTx.status !== "PENDING" || !referralInTx.walletUserId) {
        return { action: "not_pending", referral_id: referralInTx.id };
      }

      const benefit = await this.referrals.findBenefitByWalletUserId(walletUserId, tx);
      if (!benefit) return { action: "no_benefit_record", referral_id: referralInTx.id };
      if (benefit.status !== "PENDING") {
        return { action: "benefit_not_pending", referral_id: referralInTx.id, benefit_status: benefit.status };
      }

      const transaction = await creditWalletInTransaction(tx, {
        walletId: wallet.id,
        amount: benefit.amount,
        transactionType: "REFERRAL_REWARD",
        idempotencyKey: `REFERRAL_SIGNUP_BONUS_CONFIRMED:${benefit.id}`,
        displayName: "代理店紹介登録特典",
        sourceService: "AGENCY_SYSTEM",
        sourceReferenceId: referralInTx.id,
        createdByType: "EXTERNAL_SERVICE",
        metadata: { referralId: referralInTx.id, benefitId: benefit.id, eventId: params.eventId },
      });

      await this.referrals.updateBenefit(
        benefit.id,
        { status: "CONFIRMED", confirmedAt: new Date(), ledgerTransactionId: transaction.id },
        tx,
      );
      assertValidReferralTransition(referralInTx.status, "CONFIRMED");
      await this.referrals.update(referralInTx.id, { status: "CONFIRMED", confirmedAt: new Date() }, tx);

      return { action: "confirmed", referral_id: referralInTx.id, transaction_id: transaction.id };
    });
  }

  /**
   * `confirmAfterCommonUserResolve` (即時・ベストエフォート) と `AgencyReferralOutboxHandler`
   * (Outbox再送) の両方から呼ばれる共通ロジック。呼び出し元によって「呼び出し失敗」を
   * 再送対象として扱うか無視するかが異なるため、結果種別を返すだけで例外は投げない
   * (例外を投げるかどうかは呼び出し元が`outcome`を見て決める)。
   */
  private async attemptConfirm(
    oveAccountId: string,
    commonUserId: string,
  ): Promise<"confirmed" | "rejected" | "not_applicable" | "no_canonical_token" | "call_failed"> {
    const referral = await this.referrals.findByWalletUserId(oveAccountId);
    if (!referral || referral.status !== "PENDING") return "not_applicable";
    if (!referral.referralSessionKey || !referral.canonicalReferralTokenEncrypted) return "no_canonical_token";

    const canonicalToken = decryptSecret(referral.canonicalReferralTokenEncrypted, getEncryptionKey());
    const confirmResult = await this.agencyClient.confirm({
      referralSessionKey: referral.referralSessionKey,
      canonicalReferralToken: canonicalToken,
      commonUserId,
      walletUserId: oveAccountId,
    });
    if (!confirmResult) return "call_failed"; // ENABLE_AGENCY_REFERRAL_SYNC無効、または呼び出し失敗

    if (confirmResult.status === "confirmed") {
      // walletUserIdが既に判明しているため、referralSessionKeyの一意性に依存しない
      // (呼び出し元がアカウントを既に特定できている点でイベント受信経路と異なる)。
      await this.confirmBenefitFromEvent({ walletUserId: oveAccountId, commonUserId, eventId: `sync:${referral.id}` });
      return "confirmed";
    }
    if (confirmResult.status === "rejected") {
      await this.rejectReferral.reject(referral, "AGENCY_REJECTED");
      return "rejected";
    }
    return "call_failed"; // 未知のstatus。成功と誤認せず再送対象として扱う。
  }

  /**
   * `AccountRegistrationService`(旧`AccountsService.tryLinkCommonUser`)から、
   * common_user_id解決に成功した直後にベストエフォートで呼ばれる
   * (指示書5.2章「本人ログイン・common user resolve後にconfirmする」)。呼び出し失敗時は
   * 例外を投げず、そのままPENDINGを維持する (本人のログイン応答は絶対にブロックしない)。
   * 取りこぼしは`AgencyReferralOutboxHandler` (Outbox再送、`wallet.referral.registered`
   * イベント) が後から回収する。
   */
  async confirmAfterCommonUserResolve(oveAccountId: string, commonUserId: string): Promise<void> {
    await this.attemptConfirm(oveAccountId, commonUserId);
  }

  /**
   * `AgencyReferralOutboxHandler.send`から呼ばれる。呼び出し失敗 (`call_failed`) を
   * 明示的な例外として投げ、`OutboxService`の指数バックオフ再送・DLQに乗せる
   * (契約6.4章「外部API timeout時は成功・失敗を推測せず、同じevent_idで再送する」)。
   * それ以外の結果 (確定・否認・対象外・capture未完了) はこれ以上再送する意味が無いため
   * 正常終了として扱う。
   */
  async retryConfirmViaOutbox(oveAccountId: string, commonUserId: string): Promise<void> {
    const outcome = await this.attemptConfirm(oveAccountId, commonUserId);
    if (outcome === "call_failed") {
      throw new Error(
        `agency referral confirm call failed for account ${oveAccountId} (feature disabled or transient error); will retry`,
      );
    }
  }
}
