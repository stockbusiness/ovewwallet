import { Inject, Injectable } from "@nestjs/common";
import { generateId, Prisma, type PrismaClient, type CommonUserHubConfig } from "@ove/database";
import { encryptSecret } from "@ove/auth";
import { PRISMA } from "../common/prisma.module";

const CONFIG_ID = "default";
const DEFAULT_BASE_URL = "https://sengoku-ai.com";
const DEFAULT_SYSTEM_KEY = "ove-wallet";
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "dev-only-insecure-encryption-key";

export interface CommonUserHubConfigView {
  baseUrl: string;
  systemKey: string;
  apiKeySet: boolean;
  apiKeyPreview: string | null;
  updatedAt: Date | null;
  updatedBy: string | null;
}

/** APIキーの末尾4文字だけを残し、それ以外を*でマスクする (ApiAccessLog.apiKeyPrefixと逆方向のマスク)。 */
function maskApiKey(key: string): string {
  if (key.length <= 4) return "*".repeat(key.length);
  return `${"*".repeat(key.length - 4)}${key.slice(-4)}`;
}

/**
 * 代理店システム内共通顧客HUBへの送信設定 (外部開発者向け連携ガイド9章) を
 * 管理画面から編集する。`CommonUserHubClient`はここで保存された設定
 * (`common_user_hub_config`、シングルトン行) を参照する。APIキーは
 * `ServiceIntegration.signingSecretEncrypted`と同じAES-256-GCM可逆暗号化で
 * 保存し、生値はレスポンスへ一切含めない (末尾4文字のみのマスク表示)。
 */
@Injectable()
export class AdminCommonUserHubService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  private toView(config: CommonUserHubConfig | null): CommonUserHubConfigView {
    return {
      baseUrl: config?.baseUrl ?? DEFAULT_BASE_URL,
      systemKey: config?.systemKey ?? DEFAULT_SYSTEM_KEY,
      apiKeySet: !!config?.apiKeyEncrypted,
      apiKeyPreview: config?.apiKeyPreview ?? null,
      updatedAt: config?.updatedAt ?? null,
      updatedBy: config?.updatedBy ?? null,
    };
  }

  async get(): Promise<CommonUserHubConfigView> {
    const config = await this.db.commonUserHubConfig.findUnique({ where: { id: CONFIG_ID } });
    return this.toView(config);
  }

  async update(
    params: { baseUrl?: string; systemKey?: string; apiKey?: string },
    adminId: string,
    reason: string,
  ): Promise<CommonUserHubConfigView> {
    const existing = await this.db.commonUserHubConfig.findUnique({ where: { id: CONFIG_ID } });

    const baseUrl = params.baseUrl ?? existing?.baseUrl ?? DEFAULT_BASE_URL;
    const systemKey = params.systemKey ?? existing?.systemKey ?? DEFAULT_SYSTEM_KEY;
    const apiKeyEncrypted = params.apiKey ? encryptSecret(params.apiKey, ENCRYPTION_KEY) : (existing?.apiKeyEncrypted ?? null);
    const apiKeyPreview = params.apiKey ? maskApiKey(params.apiKey) : (existing?.apiKeyPreview ?? null);

    const updated = await this.db.commonUserHubConfig.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID, baseUrl, systemKey, apiKeyEncrypted, apiKeyPreview, updatedBy: adminId },
      update: { baseUrl, systemKey, apiKeyEncrypted, apiKeyPreview, updatedBy: adminId },
    });

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType: "COMMON_USER_HUB_CONFIG_UPDATED",
        targetType: "common_user_hub_config",
        targetId: CONFIG_ID,
        result: "SUCCESS",
        reason,
        beforeData: existing
          ? { baseUrl: existing.baseUrl, systemKey: existing.systemKey, apiKeySet: !!existing.apiKeyEncrypted }
          : Prisma.JsonNull,
        afterData: { baseUrl: updated.baseUrl, systemKey: updated.systemKey, apiKeySet: !!updated.apiKeyEncrypted },
      },
    });

    return this.toView(updated);
  }
}
