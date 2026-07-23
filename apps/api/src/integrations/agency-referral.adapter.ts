import { Injectable, Logger } from "@nestjs/common";
import { IntegrationHttpClient } from "./integration-http-client";
import { IntegrationConfigProvider } from "./integration-config-provider";
import { CaptureReferralResponseSchema, ConfirmReferralResponseSchema } from "./integration-response-schemas";

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
 * (`POST /api/referrals/capture` / `POST /api/referrals/confirm`) 呼び出し
 * (紹介Phase 2、`docs/integration/AGENCY_REFERRAL_PHASE2_PLAN.md`参照)。
 *
 * リファクタリング指示書 Phase 7により、送信の共通処理は`IntegrationHttpClient`に、
 * 送信設定解決は`IntegrationConfigProvider`に委譲する
 * (`CommonUserHubAdapter`と同じ連携先=代理店システムのため、同じ設定行を
 * `ENABLE_AGENCY_REFERRAL_SYNC`フラグで共有する)。呼び出し失敗時は例外を投げず
 * nullを返すベストエフォート設計は旧`AgencyReferralClient`と同一。
 */
@Injectable()
export class AgencyReferralAdapter {
  private readonly logger = new Logger(AgencyReferralAdapter.name);

  constructor(
    private readonly http: IntegrationHttpClient,
    private readonly configProvider: IntegrationConfigProvider,
  ) {}

  async capture(rawReferralValue: string): Promise<CaptureReferralResult | null> {
    const config = await this.configProvider.resolveAgencySystemConfig("ENABLE_AGENCY_REFERRAL_SYNC");
    if (!config) return null;

    const result = await this.http.request({
      baseUrl: config.baseUrl,
      path: "/api/referrals/capture",
      apiKey: config.apiKey,
      body: { system_key: config.systemKey, raw_referral_value: rawReferralValue, source: "ove_wallet" },
      responseSchema: CaptureReferralResponseSchema,
      logger: this.logger,
    });
    if (!result.ok) return null;

    const body = result.data;
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
  }

  async confirm(params: ConfirmReferralParams): Promise<ConfirmReferralResult | null> {
    const config = await this.configProvider.resolveAgencySystemConfig("ENABLE_AGENCY_REFERRAL_SYNC");
    if (!config) return null;

    const result = await this.http.request({
      baseUrl: config.baseUrl,
      path: "/api/referrals/confirm",
      apiKey: config.apiKey,
      body: {
        system_key: config.systemKey,
        referral_session_key: params.referralSessionKey,
        canonical_referral_token: params.canonicalReferralToken,
        common_user_id: params.commonUserId ?? undefined,
        external_user_id: params.walletUserId,
      },
      responseSchema: ConfirmReferralResponseSchema,
      logger: this.logger,
    });
    if (!result.ok) return null;

    return { status: result.data.status ?? "confirmed" };
  }
}
