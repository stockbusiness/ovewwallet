import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  generateId,
  type OveAccount,
  type Prisma,
  type PrismaClient,
  type WalletReferral,
} from "@ove/database";
import { encryptSecret, decryptSecret, generateOpaqueToken, sha256Hex } from "@ove/auth";
import { PRISMA } from "../common/prisma.module";
import { OutboxService } from "../outbox/outbox.service";
import { isFeatureEnabled } from "../common/feature-flags";

const REFERRAL_TOKEN_PATTERN = /^[A-Za-z0-9._~-]{1,255}$/;
const REFERRAL_SESSION_TTL_HOURS = Number(process.env.REFERRAL_SESSION_TTL_HOURS || "24");
export const REFERRAL_SIGNUP_BONUS_AMOUNT = BigInt(process.env.REFERRAL_SIGNUP_BONUS_AMOUNT || "3000");

function getEncryptionKey(): string {
  return process.env.ENCRYPTION_KEY || "dev-only-insecure-encryption-key";
}

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

    await this.db.walletReferral.create({
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
}
