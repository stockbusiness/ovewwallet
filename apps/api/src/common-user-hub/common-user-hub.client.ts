import { Inject, Injectable, Logger } from "@nestjs/common";
import { decryptSecret } from "@ove/auth";
import type { PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { isFeatureEnabled } from "../common/feature-flags";
import { getEncryptionKey } from "../common/encryption-key";

const CONFIG_ID = "default";
const DEFAULT_BASE_URL = "https://sengoku-ai.com";
const DEFAULT_SYSTEM_KEY = "ove-wallet";

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
 * 送信先URL・system_key・APIキーは管理画面(`/common-user-hub-config`、
 * `AdminCommonUserHubService`)で設定する `common_user_hub_config` テーブル
 * (シングルトン行) から読む。`ENABLE_PLATFORM_USER_ID` 無効時、または
 * APIキー未設定時は何もせずnull/falseを返す。
 *
 * 呼び出しが失敗しても例外を投げず、呼び出し元(アカウント登録処理等)を
 * ブロックしない (ガイド29.4章「タイムアウト時: 登録自体を失わず、連携待ちとして
 * 保存する」に倣ったベストエフォート設計)。解決できなかった場合の
 * バックフィルは、将来の「HUB突合バッチ」(既存データ移行) で扱う想定。
 */
@Injectable()
export class CommonUserHubClient {
  private readonly logger = new Logger(CommonUserHubClient.name);

  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  private async loadConfig(): Promise<{ baseUrl: string; systemKey: string; apiKey: string } | null> {
    if (!isFeatureEnabled("ENABLE_PLATFORM_USER_ID")) return null;

    const config = await this.db.commonUserHubConfig.findUnique({ where: { id: CONFIG_ID } });
    if (!config?.apiKeyEncrypted) return null;

    return {
      baseUrl: config.baseUrl || DEFAULT_BASE_URL,
      systemKey: config.systemKey || DEFAULT_SYSTEM_KEY,
      apiKey: decryptSecret(config.apiKeyEncrypted, getEncryptionKey()),
    };
  }

  async resolve(params: ResolveCommonUserParams): Promise<ResolveCommonUserResult | null> {
    const config = await this.loadConfig();
    if (!config) return null;

    try {
      const res = await fetch(`${config.baseUrl}/api/common-users/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": config.apiKey },
        body: JSON.stringify({
          system_key: config.systemKey,
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
    const config = await this.loadConfig();
    if (!config) return false;

    try {
      const res = await fetch(`${config.baseUrl}/api/common-users/${params.commonUserId}/system-links`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": config.apiKey },
        body: JSON.stringify({
          system_key: config.systemKey,
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
