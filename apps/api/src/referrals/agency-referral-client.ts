import { Inject, Injectable, Logger } from "@nestjs/common";
import { decryptSecret } from "@ove/auth";
import type { PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { isFeatureEnabled } from "../common/feature-flags";

const CONFIG_ID = "default";
const DEFAULT_BASE_URL = "https://sengoku-ai.com";
const DEFAULT_SYSTEM_KEY = "ove-wallet";
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "dev-only-insecure-encryption-key";

export interface CaptureReferralResult {
  referralSessionKey: string;
  canonicalReferralToken: string;
  agencyId: string | null;
  status: string;
  expiresAt: string | null;
}

export interface ConfirmReferralParams {
  referralSessionKey: string;
  canonicalReferralToken: string;
  commonUserId: string | null;
  walletUserId: string;
}

export interface ConfirmReferralResult {
  status: string;
}

/**
 * 千ノ国 全体統合 共通実装契約 v1.0 5章の代理店システム紹介関係API
 * (`POST /api/referrals/capture` / `POST /api/referrals/confirm`) 呼び出しクライアント
 * (紹介Phase 2、`docs/integration/AGENCY_REFERRAL_PHASE2_PLAN.md`参照)。
 *
 * 送信先URL・system_key・APIキーは`CommonUserHubClient`と同じ`common_user_hub_config`
 * (同一の連携先=代理店システムのため、送信設定テーブルを新設せず再利用する)。
 * `ENABLE_AGENCY_REFERRAL_SYNC`無効時やAPIキー未設定時は何もせずnullを返す。
 *
 * リクエスト本文の正確なフィールド名は契約書に明記が無い箇所があり (未対応事項参照)、
 * 呼び出し失敗時は例外を投げずnullを返すベストエフォート設計とする
 * (`CommonUserHubClient`と同じ方針、呼び出し元の登録・ログイン処理をブロックしない)。
 */
@Injectable()
export class AgencyReferralClient {
  private readonly logger = new Logger(AgencyReferralClient.name);

  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  private async loadConfig(): Promise<{ baseUrl: string; systemKey: string; apiKey: string } | null> {
    if (!isFeatureEnabled("ENABLE_AGENCY_REFERRAL_SYNC")) return null;

    const config = await this.db.commonUserHubConfig.findUnique({ where: { id: CONFIG_ID } });
    if (!config?.apiKeyEncrypted) return null;

    return {
      baseUrl: config.baseUrl || DEFAULT_BASE_URL,
      systemKey: config.systemKey || DEFAULT_SYSTEM_KEY,
      apiKey: decryptSecret(config.apiKeyEncrypted, ENCRYPTION_KEY),
    };
  }

  async capture(rawReferralValue: string): Promise<CaptureReferralResult | null> {
    const config = await this.loadConfig();
    if (!config) return null;

    try {
      const res = await fetch(`${config.baseUrl}/api/referrals/capture`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": config.apiKey },
        body: JSON.stringify({ system_key: config.systemKey, raw_referral_value: rawReferralValue, source: "ove_wallet" }),
      });

      if (!res.ok) {
        this.logger.warn(`referrals/capture failed with status ${res.status}`);
        return null;
      }

      const body = (await res.json()) as {
        referral_session_key?: string;
        canonical_referral_token?: string;
        agency_id?: string | null;
        status?: string;
        expires_at?: string | null;
      };
      if (!body.referral_session_key || !body.canonical_referral_token) {
        this.logger.warn("referrals/capture returned an incomplete response");
        return null;
      }

      return {
        referralSessionKey: body.referral_session_key,
        canonicalReferralToken: body.canonical_referral_token,
        agencyId: body.agency_id ?? null,
        status: body.status ?? "captured",
        expiresAt: body.expires_at ?? null,
      };
    } catch (error) {
      this.logger.warn(`referrals/capture request error: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async confirm(params: ConfirmReferralParams): Promise<ConfirmReferralResult | null> {
    const config = await this.loadConfig();
    if (!config) return null;

    try {
      const res = await fetch(`${config.baseUrl}/api/referrals/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": config.apiKey },
        body: JSON.stringify({
          system_key: config.systemKey,
          referral_session_key: params.referralSessionKey,
          canonical_referral_token: params.canonicalReferralToken,
          common_user_id: params.commonUserId ?? undefined,
          external_user_id: params.walletUserId,
        }),
      });

      if (!res.ok) {
        this.logger.warn(`referrals/confirm failed with status ${res.status}`);
        return null;
      }

      const body = (await res.json()) as { status?: string };
      return { status: body.status ?? "confirmed" };
    } catch (error) {
      this.logger.warn(`referrals/confirm request error: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}
