import { Injectable, Logger } from "@nestjs/common";
import { isFeatureEnabled } from "../common/feature-flags";

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

interface ResolveResponseBody {
  ok: boolean;
  common_user_id?: string;
  created?: boolean;
  matched_by?: string;
}

/**
 * 代理店システム内共通顧客HUB (千ノ国 代理店システム 外部開発者向け連携ガイド
 * v3.6.78-draft 9章) への送信専用クライアント。`POST /api/common-users/resolve`
 * (9.1章) と `POST /api/common-users/{common_user_id}/system-links` (9.3章) を
 * 呼び出す。
 *
 * `ENABLE_PLATFORM_USER_ID` 無効時、または送信用APIキー
 * (`SENGOKU_AI_OUTBOUND_API_KEY`) 未設定時は何もせずnull/falseを返す。
 * 呼び出しが失敗しても例外を投げず、呼び出し元(アカウント登録処理等)を
 * ブロックしない (ガイド29.4章「タイムアウト時: 登録自体を失わず、連携待ちとして
 * 保存する」に倣ったベストエフォート設計)。解決できなかった場合の
 * バックフィルは、将来の「HUB突合バッチ」(既存データ移行) で扱う想定。
 */
@Injectable()
export class CommonUserHubClient {
  private readonly logger = new Logger(CommonUserHubClient.name);

  private get baseUrl(): string {
    return process.env.SENGOKU_AI_COMMON_USER_HUB_URL || "https://sengoku-ai.com";
  }

  private get apiKey(): string {
    return process.env.SENGOKU_AI_OUTBOUND_API_KEY || "";
  }

  private get systemKey(): string {
    return process.env.SENGOKU_AI_SYSTEM_KEY || "ove-wallet";
  }

  private get enabled(): boolean {
    return isFeatureEnabled("ENABLE_PLATFORM_USER_ID") && this.apiKey !== "";
  }

  async resolve(params: ResolveCommonUserParams): Promise<ResolveCommonUserResult | null> {
    if (!this.enabled) return null;

    try {
      const res = await fetch(`${this.baseUrl}/api/common-users/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.apiKey },
        body: JSON.stringify({
          system_key: this.systemKey,
          external_user_id: params.externalUserId,
          email: params.email ?? undefined,
          phone: params.phone ?? undefined,
          display_name: params.displayName ?? undefined,
          create_if_missing: true,
          metadata: params.metadata,
        }),
      });

      if (!res.ok) {
        this.logger.warn(`common-users/resolve failed with status ${res.status}`);
        return null;
      }

      const body = (await res.json()) as ResolveResponseBody;
      if (!body.ok || !body.common_user_id) {
        this.logger.warn("common-users/resolve returned ok=false or no common_user_id");
        return null;
      }

      return {
        commonUserId: body.common_user_id,
        created: body.created ?? false,
        matchedBy: body.matched_by ?? "unknown",
      };
    } catch (error) {
      this.logger.warn(`common-users/resolve request error: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  async linkSystemAccount(params: LinkSystemAccountParams): Promise<boolean> {
    if (!this.enabled) return false;

    try {
      const res = await fetch(`${this.baseUrl}/api/common-users/${params.commonUserId}/system-links`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.apiKey },
        body: JSON.stringify({
          system_key: this.systemKey,
          external_user_id: params.externalUserId,
          email: params.email ?? undefined,
          display_name: params.displayName ?? undefined,
          status: params.status ?? "active",
        }),
      });

      if (!res.ok) {
        this.logger.warn(`common-users/system-links failed with status ${res.status}`);
        return false;
      }
      return true;
    } catch (error) {
      this.logger.warn(
        `common-users/system-links request error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
  }
}
