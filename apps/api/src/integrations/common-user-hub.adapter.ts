import { Injectable, Logger } from "@nestjs/common";
import { IntegrationHttpClient } from "./integration-http-client";
import { IntegrationConfigProvider } from "./integration-config-provider";
import { ResolveCommonUserResponseSchema } from "./integration-response-schemas";

export interface ResolveCommonUserParams {
  externalUserId: string;
  email?: string | null;
  phone?: string | null;
  displayName?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ResolveCommonUserResult {
  commonUserId: string;
  created: boolean;
  matchedBy: string;
}

export interface LinkSystemAccountParams {
  commonUserId: string;
  externalUserId: string;
  email?: string | null;
  displayName?: string | null;
  status?: string;
}

/**
 * 代理店システム内共通顧客HUB (千ノ国 代理店システム 外部開発者向け連携ガイド
 * v3.6.78-draft 9章) への送信。`POST /api/common-users/resolve` (9.1章) と
 * `POST /api/common-users/{common_user_id}/system-links` (9.3章) を呼び出す。
 *
 * リファクタリング指示書 Phase 7により、送信の共通処理(timeout/エラー分類等)は
 * `IntegrationHttpClient`に、送信設定解決は`IntegrationConfigProvider`に委譲する。
 * 呼び出しが失敗しても例外を投げず、呼び出し元をブロックしないベストエフォート設計は
 * 旧`CommonUserHubClient`と同一(ガイド29.4章「タイムアウト時: 登録自体を失わず、
 * 連携待ちとして保存する」)。
 */
@Injectable()
export class CommonUserHubAdapter {
  private readonly logger = new Logger(CommonUserHubAdapter.name);

  constructor(
    private readonly http: IntegrationHttpClient,
    private readonly configProvider: IntegrationConfigProvider,
  ) {}

  async resolve(params: ResolveCommonUserParams): Promise<ResolveCommonUserResult | null> {
    const config = await this.configProvider.resolveAgencySystemConfig("ENABLE_PLATFORM_USER_ID");
    if (!config) return null;

    const result = await this.http.request({
      baseUrl: config.baseUrl,
      path: "/api/common-users/resolve",
      apiKey: config.apiKey,
      body: {
        system_key: config.systemKey,
        external_user_id: params.externalUserId,
        email: params.email ?? undefined,
        phone: params.phone ?? undefined,
        display_name: params.displayName ?? undefined,
        create_if_missing: true,
        metadata: params.metadata,
      },
      responseSchema: ResolveCommonUserResponseSchema,
      logger: this.logger,
    });
    if (!result.ok) return null;

    const body = result.data;
    if (!body.ok || !body.common_user_id) {
      this.logger.warn("common-users/resolve returned ok=false or no common_user_id");
      return null;
    }

    return {
      commonUserId: body.common_user_id,
      created: body.created ?? false,
      matchedBy: body.matched_by ?? "unknown",
    };
  }

  async linkSystemAccount(params: LinkSystemAccountParams): Promise<boolean> {
    const config = await this.configProvider.resolveAgencySystemConfig("ENABLE_PLATFORM_USER_ID");
    if (!config) return false;

    const result = await this.http.request({
      baseUrl: config.baseUrl,
      path: `/api/common-users/${params.commonUserId}/system-links`,
      apiKey: config.apiKey,
      body: {
        system_key: config.systemKey,
        external_user_id: params.externalUserId,
        email: params.email ?? undefined,
        display_name: params.displayName ?? undefined,
        status: params.status ?? "active",
      },
      logger: this.logger,
    });

    return result.ok;
  }
}
