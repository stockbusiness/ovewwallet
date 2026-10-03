import { Inject, Injectable } from "@nestjs/common";
import { decryptSecret, encryptSecret } from "@ove/auth";
import {
  generateId,
  Prisma,
  type MarketClaimConfig as MarketClaimConfigRow,
  type PrismaClient,
} from "@ove/database";
import { getEncryptionKey } from "../common/encryption-key";
import { PRISMA } from "../common/prisma.module";

export const MARKET_CLAIM_CONFIG_ID = "default";

export interface ResolvedMarketClaimConfig {
  baseUrl: string;
  keyId: string;
  hmacSecret: string;
}

/** Secretの末尾4文字だけを残す (`MailConfigService.maskApiKey`と同じ)。 */
export function maskSecret(value: string): string {
  if (value.length <= 4) return "*".repeat(value.length);
  return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
}

/** 末尾スラッシュを落とす。`${baseUrl}${path}`で連結するため、残すと `//api/...` になる。 */
function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/u, "");
}


/**
 * 環境変数から3点を読む。1つでも欠けていれば`null`。
 * 「URLだけ環境変数・鍵だけDB」のような混在を作らないため、まとめて判定する。
 */
function readEnvConfig(env: NodeJS.ProcessEnv): ResolvedMarketClaimConfig | null {
  const baseUrl = env["SENGOKU_MARKET_CLAIM_BASE_URL"];
  const keyId = env["SENGOKU_MARKET_CLAIM_KEY_ID"];
  const hmacSecret = env["SENGOKU_MARKET_CLAIM_HMAC_SECRET"];
  if (!baseUrl || !keyId || !hmacSecret) return null;
  return { baseUrl: normalizeBaseUrl(baseUrl), keyId, hmacSecret };
}

/** DB行に3点が揃っているか。表示用の判定にも使うので、ここでは復号しない。 */
function rowIsComplete(row: MarketClaimConfigRow | null): row is MarketClaimConfigRow {
  return !!row?.hmacSecretEncrypted && !!row.baseUrl && !!row.keyId;
}

/** DB行から3点を読む。1つでも欠けていれば`null` (環境変数と混ぜない)。 */
function readRowConfig(row: MarketClaimConfigRow | null): ResolvedMarketClaimConfig | null {
  if (!rowIsComplete(row)) return null;
  return {
    baseUrl: normalizeBaseUrl(row.baseUrl!),
    keyId: row.keyId!,
    hmacSecret: decryptSecret(row.hmacSecretEncrypted!, getEncryptionKey()),
  };
}

/** 画面に出す「現在値」。DB行を優先し、無ければ環境変数の値を見せる。鍵の生値は出さない。 */
function describeCurrentValues(
  row: MarketClaimConfigRow | null,
  envConfig: ResolvedMarketClaimConfig | null,
) {
  return {
    baseUrl: row?.baseUrl ?? envConfig?.baseUrl ?? null,
    keyId: row?.keyId ?? envConfig?.keyId ?? null,
    hmacSecretSet: row?.hmacSecretEncrypted != null,
    hmacSecretPreview: row?.hmacSecretPreview ?? null,
  };
}

/** 最終更新の表示。 */
function describeAudit(row: MarketClaimConfigRow | null) {
  return {
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

/**
 * 千ノ国マーケットの受取確認API (Claim) への接続設定の解決。
 *
 * ## 管理画面 (DB) が環境変数より優先
 *
 * 鍵の入れ替えにデプロイを待たせないため。環境変数 `SENGOKU_MARKET_CLAIM_*` は
 * 初期設定と緊急時の逃げ道として残す (`MailConfigService`と同じ方針)。
 * 3点 (baseUrl / keyId / secret) は**それぞれ独立に**フォールバックせず、
 * 「DBに鍵がある行が1つでもあればDB、無ければ環境変数」とまとめて切り替える。
 * URLだけDB・鍵だけ環境変数のような混在は、どちらの組で署名したのか追えなくなるため。
 *
 * ## 毎回読み直す
 *
 * 起動時に固めない。管理画面で鍵を変えた直後から新しい鍵で送れるようにするため。
 * 単一行の主キー検索なので、呼び出しのたびに引いても負荷にならない。
 */
@Injectable()
export class MarketClaimConfigService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async resolve(env: NodeJS.ProcessEnv = process.env): Promise<ResolvedMarketClaimConfig | null> {
    const row = await this.db.marketClaimConfig.findUnique({ where: { id: MARKET_CLAIM_CONFIG_ID } });
    return readRowConfig(row) ?? readEnvConfig(env);
  }

  /** 管理画面表示用。生値は返さない。 */
  async describe(env: NodeJS.ProcessEnv = process.env) {
    const row = await this.db.marketClaimConfig.findUnique({ where: { id: MARKET_CLAIM_CONFIG_ID } });
    const envConfig = readEnvConfig(env);
    const fromDb = rowIsComplete(row);

    return {
      ...describeCurrentValues(row, envConfig),
      /** 管理画面が未設定でも環境変数で動く状態かどうか。 */
      fallbackFromEnv: !fromDb && envConfig !== null,
      /** 送信に使える状態か (DBか環境変数のどちらかが揃っている)。 */
      configured: fromDb || envConfig !== null,
      ...describeAudit(row),
    };
  }

  /** Secretを空欄で保存すると現在の鍵を維持する (`MailConfigService.save`と同じ挙動)。 */
  async save(
    params: { baseUrl?: string; keyId?: string; hmacSecret?: string },
    adminId: string,
    reason: string,
  ): Promise<void> {
    const existing = await this.db.marketClaimConfig.findUnique({ where: { id: MARKET_CLAIM_CONFIG_ID } });

    const baseUrl = params.baseUrl ?? existing?.baseUrl ?? null;
    const keyId = params.keyId ?? existing?.keyId ?? null;
    const hmacSecretEncrypted = params.hmacSecret
      ? encryptSecret(params.hmacSecret, getEncryptionKey())
      : (existing?.hmacSecretEncrypted ?? null);
    const hmacSecretPreview = params.hmacSecret
      ? maskSecret(params.hmacSecret)
      : (existing?.hmacSecretPreview ?? null);

    await this.db.marketClaimConfig.upsert({
      where: { id: MARKET_CLAIM_CONFIG_ID },
      create: {
        id: MARKET_CLAIM_CONFIG_ID,
        baseUrl,
        keyId,
        hmacSecretEncrypted,
        hmacSecretPreview,
        updatedBy: adminId,
      },
      update: { baseUrl, keyId, hmacSecretEncrypted, hmacSecretPreview, updatedBy: adminId },
    });

    // 本番の外部連携鍵を触る操作なので、誰がいつ変えたかを残す。鍵そのものは記録しない。
    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType: "MARKET_CLAIM_CONFIG_UPDATED",
        targetType: "market_claim_config",
        targetId: MARKET_CLAIM_CONFIG_ID,
        result: "SUCCESS",
        reason,
        beforeData: existing
          ? { baseUrl: existing.baseUrl, keyId: existing.keyId, hmacSecretSet: !!existing.hmacSecretEncrypted }
          : Prisma.JsonNull,
        afterData: { baseUrl, keyId, hmacSecretSet: !!hmacSecretEncrypted },
      },
    });
  }
}
