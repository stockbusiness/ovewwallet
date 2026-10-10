import { Injectable, Logger } from "@nestjs/common";
import { generateOpaqueToken, sha256Hex } from "@ove/auth";
import { generateId, type WalletUserReferral } from "@ove/database";
import { isFeatureEnabled } from "../common/feature-flags";
import { WalletUserReferralRepository } from "./wallet-user-referral.repository";

/** 紹介コードの文字種。`generateOpaqueToken`のbase64urlに合わせる。 */
const REFERRAL_CODE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * 紹介セッションの有効期限。代理店紹介と**同じ環境変数**を使う。利用者から見ると
 * どちらも同じ「紹介リンクから登録する」体験で、寿命だけ違うと問い合わせ対応が
 * 噛み合わないため、別の値を設定できるようにしない。
 */
const SESSION_TTL_HOURS = Number(process.env.REFERRAL_SESSION_TTL_HOURS || "24");

/**
 * `/r/{code}` の受付と、ログイン処理冒頭でのセッション解決。
 *
 * 代理店紹介の`ReferralCaptureUseCase`と同じ形にしてある。違いは、紹介元が
 * 外部発行のトークンではなく**ウォレット内のアカウント**である点だけ。
 */
@Injectable()
export class WalletUserReferralCaptureUseCase {
  private readonly logger = new Logger(WalletUserReferralCaptureUseCase.name);

  constructor(private readonly referrals: WalletUserReferralRepository) {}

  /**
   * 紹介コードを受け付けてセッションを作る。Flag OFF・コード形式不正・
   * 該当アカウント無し・退会済みのいずれでも `null` を返すだけで、呼び出し元は
   * そのままログイン画面へ戻す (代理店紹介の「無効なトークンでも登録は継続する」
   * と同じ方針。紹介が成立しないことを理由に登録を止めない)。
   */
  async capture(params: {
    code: string;
    ipHash?: string;
    userAgentHash?: string;
  }): Promise<{ cookieToken: string; expiresAt: Date } | null> {
    if (!isFeatureEnabled("ENABLE_WALLET_USER_REFERRAL")) return null;
    if (!REFERRAL_CODE_PATTERN.test(params.code)) {
      this.logger.warn("wallet user referral capture: invalid code format (value omitted from logs)");
      return null;
    }

    const referrer = await this.referrals.findAccountByReferralCode(params.code);
    if (!referrer) return null;
    // 退会したアカウントの紹介リンクは成立させない (紹介者が居ないため、
    // 後から代理店資格を取得して継承することもない)。
    if (referrer.status === "CLOSED") return null;

    const cookieToken = generateOpaqueToken(32);
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

    await this.referrals.create({
      id: generateId(),
      referrerAccountId: referrer.id,
      sessionTokenHash: sha256Hex(cookieToken),
      status: "CAPTURED",
      expiresAt,
      createdIpHash: params.ipHash,
      userAgentHash: params.userAgentHash,
    });

    return { cookieToken, expiresAt };
  }

  /**
   * ログイン処理の冒頭で呼ぶ。Cookieが無い・無効・期限切れ・使用済みの場合は
   * null を返し、呼び出し元は紹介なしの通常ログインとして処理を続ける。
   */
  async resolvePendingSession(cookieToken: string | undefined): Promise<WalletUserReferral | null> {
    if (!cookieToken) return null;

    const referral = await this.referrals.findBySessionTokenHash(sha256Hex(cookieToken));
    if (!referral) return null;
    if (referral.status !== "CAPTURED" || referral.usedAt) return null;
    if (referral.expiresAt < new Date()) {
      await this.referrals.update(referral.id, { status: "EXPIRED" });
      return null;
    }
    return referral;
  }
}
