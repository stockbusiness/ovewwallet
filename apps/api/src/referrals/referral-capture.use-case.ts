import { Injectable, Logger } from "@nestjs/common";
import { generateId, type WalletReferral } from "@ove/database";
import { encryptSecret, generateOpaqueToken, sha256Hex } from "@ove/auth";
import { isFeatureEnabled } from "../common/feature-flags";
import { getEncryptionKey } from "../common/encryption-key";
import { AgencyReferralClient } from "./agency-referral-client";
import { ReferralRepository } from "./referral.repository";
import { assertValidReferralTransition } from "./referral-state-machine";

const REFERRAL_TOKEN_PATTERN = /^[A-Za-z0-9._~-]{1,255}$/;
const REFERRAL_SESSION_TTL_HOURS = Number(process.env.REFERRAL_SESSION_TTL_HOURS || "24");

/**
 * 紹介URLで一緒に渡される付随パラメータ (`referral_session_key` / `agency_id` /
 * `source`) の受け入れ形式。トークンと同じ文字種に揃え、想定外の値はログにも
 * DBにも残さず捨てる (URLは利用者が自由に書き換えられる入力のため)。
 */
const REFERRAL_PARAM_PATTERN = /^[A-Za-z0-9._~-]{1,255}$/;

function sanitizeParam(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return REFERRAL_PARAM_PATTERN.test(value) ? value : undefined;
}

/**
 * リファクタリング指示書 Phase 3: `ReferralsService`から分離した紹介トークン
 * 受付責務 (`/invite/{token}`の受付、ログイン処理冒頭でのセッション解決)。
 */
@Injectable()
export class ReferralCaptureUseCase {
  private readonly logger = new Logger(ReferralCaptureUseCase.name);

  constructor(
    private readonly referrals: ReferralRepository,
    private readonly agencyClient: AgencyReferralClient,
  ) {}

  /**
   * /invite/{token} を受け付ける。`ENABLE_WALLET_REFERRAL_TOKEN` がOFF、またはトークンの
   * 形式が不正な場合は何も保存せず null を返す (呼び出し側はログイン画面へそのまま戻す)。
   * 紹介トークンの生値はログへ出力しない。
   */
  async capture(params: {
    rawToken: string;
    /** 代理店システムが紹介URLに直接載せてきた `referral_session_key` (`rs`)。 */
    referralSessionKey?: string;
    /** 同 `agency_id`。 */
    agencyId?: string;
    /** 同 `source` (例: `sengoku-agency`)。既定は従来どおり `invite_url`。 */
    source?: string;
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

    const referralSessionKey = sanitizeParam(params.referralSessionKey);
    const agencyId = sanitizeParam(params.agencyId);
    const source = sanitizeParam(params.source);

    const created = await this.referrals.create({
      id: generateId(),
      sessionTokenHash: sha256Hex(cookieToken),
      referralTokenEncrypted: encryptSecret(params.rawToken, encryptionKey),
      referralTokenHash: sha256Hex(params.rawToken),
      status: "CAPTURED",
      source: source ?? "invite_url",
      expiresAt,
      createdIpHash: params.ipHash,
      userAgentHash: params.userAgentHash,
      // 代理店システムがURLへ直接載せてきた場合は、その値をそのまま採用する。
      // このとき紹介トークン自体がcanonicalな値として送られてくる前提のため、
      // `canonical_referral_token`にも同じ値を入れ、confirm送信時にそのまま返せる
      // ようにする (`docs/integration/AGENCY_POINT_AWARD.md` 1章)。
      ...(referralSessionKey
        ? {
            referralSessionKey,
            canonicalReferralTokenEncrypted: encryptSecret(params.rawToken, encryptionKey),
          }
        : {}),
      ...(agencyId ? { agencyId } : {}),
    });

    // URLで`referral_session_key`まで渡ってきている場合、代理店システムは既に
    // 紹介セッションを作り終えている。同じことをもう一度問い合わせる必要は無く、
    // ENABLE_AGENCY_REFERRAL_SYNCが未有効でも紐付けを進められる。
    if (referralSessionKey) {
      return { cookieToken, expiresAt };
    }

    // 紹介Phase 2 (共通実装契約5章): 代理店システムへcanonical化を照会する。
    // ENABLE_AGENCY_REFERRAL_SYNCが無効・呼び出し失敗時はnullが返るだけで、
    // /invite/{token}受付自体 (Cookie発行・ログイン画面へのリダイレクト) はブロックしない。
    const captureResult = await this.agencyClient.capture(params.rawToken);
    if (captureResult) {
      await this.referrals.update(created.id, {
        agencyId: captureResult.agencyId ?? agencyId ?? undefined,
        referralSessionKey: captureResult.referralSessionKey,
        canonicalReferralTokenEncrypted: encryptSecret(captureResult.canonicalReferralToken, encryptionKey),
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

    const referral = await this.referrals.findBySessionTokenHash(sha256Hex(cookieToken));
    if (!referral) return null;
    if (referral.status !== "CAPTURED" || referral.usedAt) return null;
    if (referral.expiresAt < new Date()) {
      assertValidReferralTransition(referral.status, "EXPIRED");
      await this.referrals.update(referral.id, { status: "EXPIRED" });
      return null;
    }
    return referral;
  }
}
