import { Inject, Injectable } from "@nestjs/common";
import { decryptSecret } from "@ove/auth";
import type { PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { getEncryptionKey } from "../common/encryption-key";
import { isFeatureEnabled, type FeatureFlagKey } from "../common/feature-flags";

const CONFIG_ID = "default";
const DEFAULT_BASE_URL = "https://sengoku-ai.com";
const DEFAULT_SYSTEM_KEY = "ove-wallet";

export interface ResolvedIntegrationConfig {
  baseUrl: string;
  systemKey: string;
  apiKey: string;
}

/**
 * リファクタリング指示書 Phase 7「外部HTTP基盤」。外部連携先への送信設定
 * (DB設定・環境変数フォールバック・APIキーのSecret復号・Feature Flag)を
 * 一元管理する。現状の連携先は代理店システム(sengoku-ai.com)のみで、
 * `CommonUserHubAdapter`/`AgencyReferralAdapter`は同一の`common_user_hub_config`
 * (シングルトン行)をFeature Flagのみ変えて共有する
 * (旧`CommonUserHubClient`/`AgencyReferralClient`の`loadConfig()`と同じ設計を踏襲)。
 */
@Injectable()
export class IntegrationConfigProvider {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async resolveAgencySystemConfig(featureFlag: FeatureFlagKey): Promise<ResolvedIntegrationConfig | null> {
    if (!isFeatureEnabled(featureFlag)) return null;
    return this.resolveAgencySystemConfigIgnoringFlag();
  }

  /**
   * Feature Flagを見ずに設定だけを解決する。**管理画面の接続テスト専用**。
   *
   * Flagを開ける**前**に「送信先URLとAPIキーが正しいか」を確かめられることが
   * 接続テストの目的なので、ここだけは意図的にFlagを無視する。
   * 実際の送信経路では使わないこと (Flagで止められなくなる)。
   */
  async resolveAgencySystemConfigIgnoringFlag(): Promise<ResolvedIntegrationConfig | null> {
    const config = await this.db.commonUserHubConfig.findUnique({ where: { id: CONFIG_ID } });
    if (!config?.apiKeyEncrypted) return null;

    return {
      baseUrl: config.baseUrl || DEFAULT_BASE_URL,
      systemKey: config.systemKey || DEFAULT_SYSTEM_KEY,
      apiKey: decryptSecret(config.apiKeyEncrypted, getEncryptionKey()),
    };
  }
}
