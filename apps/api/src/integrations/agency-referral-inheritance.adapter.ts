import { Injectable, Logger } from "@nestjs/common";
import { z } from "zod";
import { IntegrationConfigProvider } from "./integration-config-provider";
import { IntegrationHttpClient } from "./integration-http-client";

/**
 * 代理店システムの受信パス。**先方から共有され次第設定する。**
 *
 * `capture`/`confirm`と違って既定値を置かない。推測したパスを既定にすると、
 * 誤ったURLへ送り続けて404を再送し続けることになり、しかも「設定し忘れ」と
 * 区別できなくなるため。未設定なら申請を作らない (`RequestInheritanceUseCase`)。
 */
const INHERITANCE_PATH_ENV = "AGENCY_REFERRAL_INHERITANCE_PATH";

/** 受付応答。承認結果ではないため、ここでは成否だけを見る。 */
const InheritanceResponseSchema = z
  .object({
    ok: z.boolean().optional(),
    accepted: z.boolean().optional(),
  })
  .passthrough();

export interface RequestInheritanceParams {
  /** 申請イベントの一意ID。再送時も同じ値を送る。 */
  eventId: string;
  referrerCommonUserId: string;
  referredCommonUserId: string;
  /** 紹介日時。タイムゾーン付きISO 8601。 */
  referredAt: string;
  /** ウォレット側で採番した不変の紹介記録ID。 */
  referralRecordId: string;
}

export function inheritancePath(env: NodeJS.ProcessEnv = process.env): string | null {
  const value = env[INHERITANCE_PATH_ENV];
  return value && value.trim() !== "" ? value.trim() : null;
}

/**
 * ウォレット発の紹介を代理店システムへ継承申請する
 * (`wallet.referral.inheritance.requested`、`docs/wallet-user-referral.md`)。
 *
 * 送信先ホスト・APIキー・`source_system_key`は既存の代理店連携設定
 * (`common_user_hub_config`) をそのまま使う。`capture`/`confirm`と同じ経路・
 * 同じ`x-api-key`で送るため、新しい資格情報は要らない。
 *
 * **受付成功は承認を意味しない。** 承認された場合だけ、代理店システムから
 * `customer.assignment.changed`が届き、既存のハンドラが紐付けを反映する。
 */
@Injectable()
export class AgencyReferralInheritanceAdapter {
  private readonly logger = new Logger(AgencyReferralInheritanceAdapter.name);

  constructor(
    private readonly http: IntegrationHttpClient,
    private readonly configProvider: IntegrationConfigProvider,
  ) {}

  /** 送信できる状態か (Flag・送信設定・受信パスが揃っているか)。 */
  async isReady(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
    if (!inheritancePath(env)) return false;
    return (await this.configProvider.resolveAgencySystemConfig("ENABLE_WALLET_USER_REFERRAL_INHERITANCE")) !== null;
  }

  /**
   * 申請を送る。送信できなかった場合は例外を投げ、Outboxの指数バックオフ再送に
   * 乗せる (受信パスが後から設定された時点で滞留分が流れる)。
   */
  async requestInheritance(params: RequestInheritanceParams): Promise<void> {
    const path = inheritancePath();
    if (!path) throw new Error(`${INHERITANCE_PATH_ENV} is not configured; retry later`);

    const config = await this.configProvider.resolveAgencySystemConfig(
      "ENABLE_WALLET_USER_REFERRAL_INHERITANCE",
    );
    if (!config) throw new Error("agency system integration is not configured or the flag is off; retry later");

    const result = await this.http.request({
      baseUrl: config.baseUrl,
      path,
      apiKey: config.apiKey,
      body: {
        event_id: params.eventId,
        event_type: "wallet.referral.inheritance.requested",
        source_system_key: config.systemKey,
        referrer_common_user_id: params.referrerCommonUserId,
        referred_common_user_id: params.referredCommonUserId,
        referred_at: params.referredAt,
        referral_record_id: params.referralRecordId,
      },
      responseSchema: InheritanceResponseSchema,
      logger: this.logger,
    });

    // 受付に失敗したら例外を投げ、Outboxの再送に任せる。恒久的な失敗 (4xx) でも
    // 再送上限 (8回) でFAILEDになり、管理画面のOutbox一覧とSentryに出る。
    if (!result.ok) {
      const { kind, status, message } = result.error;
      throw new Error(`inheritance request was not accepted (${kind}${status ? ` ${status}` : ""}): ${message}`);
    }
  }
}
