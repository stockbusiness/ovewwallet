import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  generateId,
  type OveAccount,
  type Prisma,
  type PrismaClient,
  type WalletReferral,
} from "@ove/database";
import { encryptSecret, decryptSecret, generateOpaqueToken, sha256Hex } from "@ove/auth";
import { creditWallet } from "@ove/ledger";
import { PRISMA } from "../common/prisma.module";
import { OutboxService } from "../outbox/outbox.service";
import { isFeatureEnabled } from "../common/feature-flags";
import { getEncryptionKey } from "../common/encryption-key";
import { AgencyReferralClient } from "./agency-referral-client";

const REFERRAL_TOKEN_PATTERN = /^[A-Za-z0-9._~-]{1,255}$/;
const REFERRAL_SESSION_TTL_HOURS = Number(process.env.REFERRAL_SESSION_TTL_HOURS || "24");
export const REFERRAL_SIGNUP_BONUS_AMOUNT = BigInt(process.env.REFERRAL_SIGNUP_BONUS_AMOUNT || "3000");

/**
 * 代理店紹介トークンの受け入れ (実装指示書 v1.0)。/invite/{token} での受付から、
 * LINEログイン後の新規登録時の紐付けまでを扱う。代理店システムとの実際の確認
 * 通信 (Phase 2) はまだ実装しない — このサービスは outbox へのキュー登録までを行う。
 */
@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly outbox: OutboxService,
    private readonly agencyClient: AgencyReferralClient,
  ) {}

  /**
   * /invite/{token} を受け付ける。`ENABLE_WALLET_REFERRAL_TOKEN` がOFF、またはトークンの
   * 形式が不正な場合は何も保存せず null を返す (呼び出し側はログイン画面へそのまま戻す)。
   * 紹介トークンの生値はログへ出力しない。
   */
  async capture(params: {
    rawToken: string;
    ipHash?: string;
    userAgentHash?: string;
  }): Promise<{ cookieToken: string; expiresAt: Date } | null> {
    if (!isFeatureEnabled("ENABLE_WALLET_REFERRAL_TOKEN")) return null;
    if (!REFERRAL_TOKEN_PATTERN.test(params.rawToken)) {
      this.logger.warn("referral capture: invalid token format (value omitted from logs)");
      return null;
    }

    const encryptionKey = getEncryptionKey();
    const cookieToken = generateOpaqueToken(32);
    const expiresAt = new Date(Date.now() + REFERRAL_SESSION_TTL_HOURS * 60 * 60 * 1000);

    const created = await this.db.walletReferral.create({
      data: {
        id: generateId(),
        sessionTokenHash: sha256Hex(cookieToken),
        referralTokenEncrypted: encryptSecret(params.rawToken, encryptionKey),
        referralTokenHash: sha256Hex(params.rawToken),
        status: "CAPTURED",
        source: "invite_url",
        expiresAt,
        createdIpHash: params.ipHash,
        userAgentHash: params.userAgentHash,
      },
    });

    // 紹介Phase 2 (共通実装契約5章): 代理店システムへcanonical化を照会する。
    // ENABLE_AGENCY_REFERRAL_SYNCが無効・呼び出し失敗時はnullが返るだけで、
    // /invite/{token}受付自体 (Cookie発行・ログイン画面へのリダイレクト) はブロックしない。
    const captureResult = await this.agencyClient.capture(params.rawToken);
    if (captureResult) {
      await this.db.walletReferral.update({
        where: { id: created.id },
        data: {
          agencyId: captureResult.agencyId ?? undefined,
          referralSessionKey: captureResult.referralSessionKey,
          canonicalReferralTokenEncrypted: encryptSecret(captureResult.canonicalReferralToken, encryptionKey),
        },
      });
    }

    return { cookieToken, expiresAt };
  }

  /**
   * ログイン処理の冒頭で呼ぶ。Cookieが無い・無効・期限切れ・使用済みの場合は null を返し、
   * 呼び出し側 (AuthService) は紹介なしの通常ログインとして処理を続ける
   * (実装指示書17.2章: 無効なトークンでも登録は継続する)。
   */
  async resolvePendingSession(cookieToken: string | undefined): Promise<WalletReferral | null> {
    if (!cookieToken) return null;

    const referral = await this.db.walletReferral.findUnique({
      where: { sessionTokenHash: sha256Hex(cookieToken) },
    });
    if (!referral) return null;
    if (referral.status !== "CAPTURED" || referral.usedAt) return null;
    if (referral.expiresAt < new Date()) {
      await this.db.walletReferral.update({
        where: { id: referral.id },
        data: { status: "EXPIRED" },
      });
      return null;
    }
    return referral;
  }

  /**
   * 新規アカウント作成と同一トランザクション内で呼ぶ (`AccountsService.onNewAccountCreated`)。
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
    // status: "CAPTURED" / usedAt: null を条件に含めた条件付き更新で排他する。
    // 影響行数が0件の場合はこのリクエスト側が競合に負けたということなので、
    // 特典付与・outbox登録は行わず、通常の(紹介なし)新規登録として処理を継続する
    // (実装指示書17.2章の「無効なトークンでも登録は継続する」と同じ方針)。
    const claimed = await tx.walletReferral.updateMany({
      where: { id: referral.id, status: "CAPTURED", usedAt: null },
      data: {
        walletUserId: account.id,
        status: "PENDING",
        registeredAt: now,
        usedAt: now,
      },
    });
    if (claimed.count === 0) {
      this.logger.warn("referral attach: lost race to a concurrent request, skipping benefit/outbox");
      return;
    }

    await tx.walletReferralBenefit.create({
      data: {
        id: generateId(),
        walletUserId: account.id,
        lineUserIdHash: sha256Hex(lineUserId),
        referralId: referral.id,
        benefitType: "REFERRAL_SIGNUP_BONUS",
        amount: REFERRAL_SIGNUP_BONUS_AMOUNT,
        status: "PENDING",
        idempotencyKey: `REFERRAL_SIGNUP_BONUS:${account.id}`,
      },
    });

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
  }): Promise<{ action: string; referral_id?: string; transaction_id?: string; benefit_status?: string }> {
    let referral: WalletReferral | null = null;
    if (params.walletUserId) {
      referral = await this.db.walletReferral.findUnique({ where: { walletUserId: params.walletUserId } });
    }
    if (!referral && params.referralSessionKey) {
      referral = await this.db.walletReferral.findFirst({ where: { referralSessionKey: params.referralSessionKey } });
    }
    if (!referral && params.commonUserId) {
      // common_user_idはUNIQUE制約が無いため、2件以上ヒットした場合はどちらのアカウントの
      // 紹介関係か一意に決められない。自動処理せず対象外として扱う
      // (次期改修指示書P0-5、確定は要レビュー — referralSessionKeyでの再送に委ねる)。
      const accounts = await this.db.oveAccount.findMany({ where: { commonUserId: params.commonUserId } });
      if (accounts.length === 1) {
        referral = await this.db.walletReferral.findUnique({ where: { walletUserId: accounts[0]!.id } });
      } else if (accounts.length > 1) {
        return { action: "common_user_id_conflict" };
      }
    }
    if (!referral) return { action: "no_local_referral" };

    if (referral.status === "CONFIRMED" || referral.status === "MANUALLY_CONFIRMED") {
      return { action: "already_confirmed", referral_id: referral.id };
    }
    if (referral.status !== "PENDING" || !referral.walletUserId) {
      return { action: "not_pending", referral_id: referral.id };
    }

    const benefit = await this.db.walletReferralBenefit.findUnique({
      where: { benefitType_walletUserId: { benefitType: "REFERRAL_SIGNUP_BONUS", walletUserId: referral.walletUserId } },
    });
    if (!benefit) return { action: "no_benefit_record", referral_id: referral.id };
    if (benefit.status !== "PENDING") {
      return { action: "benefit_not_pending", referral_id: referral.id, benefit_status: benefit.status };
    }

    const wallet = await this.db.wallet.findUniqueOrThrow({ where: { oveAccountId: referral.walletUserId } });
    const transaction = await creditWallet(
      {
        walletId: wallet.id,
        amount: benefit.amount,
        transactionType: "REFERRAL_REWARD",
        idempotencyKey: `REFERRAL_SIGNUP_BONUS_CONFIRMED:${benefit.id}`,
        displayName: "代理店紹介登録特典",
        sourceService: "AGENCY_SYSTEM",
        sourceReferenceId: referral.id,
        createdByType: "EXTERNAL_SERVICE",
        metadata: { referralId: referral.id, benefitId: benefit.id, eventId: params.eventId },
      },
      this.db,
    );

    await this.db.walletReferralBenefit.update({
      where: { id: benefit.id },
      data: { status: "CONFIRMED", confirmedAt: new Date(), ledgerTransactionId: transaction.id },
    });
    await this.db.walletReferral.update({
      where: { id: referral.id },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });

    return { action: "confirmed", referral_id: referral.id, transaction_id: transaction.id };
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
    const referral = await this.db.walletReferral.findUnique({ where: { walletUserId: oveAccountId } });
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
      await this.db.walletReferral.update({
        where: { id: referral.id },
        data: { status: "REJECTED", rejectedAt: new Date(), lastErrorCode: "AGENCY_REJECTED" },
      });
      return "rejected";
    }
    return "call_failed"; // 未知のstatus。成功と誤認せず再送対象として扱う。
  }

  /**
   * `AccountsService.tryLinkCommonUser`から、common_user_id解決に成功した直後に
   * ベストエフォートで呼ばれる (指示書5.2章「本人ログイン・common user resolve後に
   * confirmする」)。呼び出し失敗時は例外を投げず、そのままPENDINGを維持する
   * (本人のログイン応答は絶対にブロックしない)。取りこぼしは
   * `AgencyReferralOutboxHandler` (Outbox再送、`wallet.referral.registered`イベント)
   * が後から回収する。
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

  async getMyReferralStatus(oveAccountId: string) {
    const benefit = await this.db.walletReferralBenefit.findUnique({
      where: { benefitType_walletUserId: { benefitType: "REFERRAL_SIGNUP_BONUS", walletUserId: oveAccountId } },
    });
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
