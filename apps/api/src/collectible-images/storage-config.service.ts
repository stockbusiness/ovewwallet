import { Inject, Injectable } from "@nestjs/common";
import { decryptSecret, encryptSecret } from "@ove/auth";
import type { PrismaClient } from "@ove/database";
import { getEncryptionKey } from "../common/encryption-key";
import { PRISMA } from "../common/prisma.module";

export const IMAGE_STORAGE_CONFIG_ID = "default";

/** R2 はregionを見ないが、SDKが必須とするため既定値を置く。 */
export const DEFAULT_STORAGE_REGION = "auto";

const ENV_BUCKET = "COLLECTIBLE_IMAGE_STORAGE_BUCKET";
const ENV_ENDPOINT = "COLLECTIBLE_IMAGE_STORAGE_ENDPOINT";
const ENV_REGION = "COLLECTIBLE_IMAGE_STORAGE_REGION";
const ENV_ACCESS_KEY_ID = "COLLECTIBLE_IMAGE_STORAGE_ACCESS_KEY_ID";
const ENV_SECRET_ACCESS_KEY = "COLLECTIBLE_IMAGE_STORAGE_SECRET_ACCESS_KEY";

/** 先に指定された空でない値を採る (管理画面 → 環境変数 の優先順)。 */
function firstSet(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (value) return value;
  }
  return null;
}

export interface ResolvedStorageConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
}

/** 鍵の末尾4文字だけを残す (`maskApiKey`と同じ)。 */
export function maskSecret(value: string): string {
  if (value.length <= 4) return "*".repeat(value.length);
  return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
}

/**
 * カード画像の保管先の設定解決 (docs/collectible-images.md)。
 *
 * ## 管理画面 (DB) が環境変数より優先
 *
 * メール送信設定 (`MailConfigService`) と同じ考え方。鍵の入れ替えにデプロイを
 * 待たせないため。環境変数は初期設定と緊急時の逃げ道として残す。
 *
 * ## 揃っていなければ「無効」
 *
 * バケット・アクセスキー・シークレットのいずれかが欠けたら `null` を返す。
 * 中途半端な設定で接続を試みても失敗するだけなので、取り込み自体を行わない。
 */
@Injectable()
export class CollectibleImageStorageConfigService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async resolve(env: NodeJS.ProcessEnv = process.env): Promise<ResolvedStorageConfig | null> {
    const row = await this.db.collectibleImageStorageConfig.findUnique({
      where: { id: IMAGE_STORAGE_CONFIG_ID },
    });

    const bucket = firstSet(row?.bucket, env[ENV_BUCKET]);
    const accessKeyId = firstSet(row?.accessKeyId, env[ENV_ACCESS_KEY_ID]);
    const secretAccessKey = row?.secretAccessKeyEncrypted
      ? decryptSecret(row.secretAccessKeyEncrypted, getEncryptionKey())
      : firstSet(env[ENV_SECRET_ACCESS_KEY]);

    if (!bucket || !accessKeyId || !secretAccessKey) return null;

    const endpoint = firstSet(row?.endpoint, env[ENV_ENDPOINT]);
    return {
      bucket,
      region: firstSet(row?.region, env[ENV_REGION]) ?? DEFAULT_STORAGE_REGION,
      accessKeyId,
      secretAccessKey,
      ...(endpoint ? { endpoint } : {}),
    };
  }

  /** 管理画面表示用。**シークレットの生値は返さない。** */
  async describe(env: NodeJS.ProcessEnv = process.env) {
    const row = await this.db.collectibleImageStorageConfig.findUnique({
      where: { id: IMAGE_STORAGE_CONFIG_ID },
    });
    const resolved = await this.resolve(env);
    return {
      configured: resolved !== null,
      bucket: firstSet(row?.bucket, env[ENV_BUCKET]),
      endpoint: firstSet(row?.endpoint, env[ENV_ENDPOINT]),
      region: firstSet(row?.region, env[ENV_REGION]) ?? DEFAULT_STORAGE_REGION,
      accessKeyId: firstSet(row?.accessKeyId, env[ENV_ACCESS_KEY_ID]),
      ...secretView(row, env),
      ...updateView(row),
    };
  }

  /**
   * 保存。**シークレットを空欄で保存しても現在の値を消さない**
   * (メール送信設定・共通顧客HUB設定と同じ挙動)。
   *
   * バケット等の空文字は「未設定へ戻す」意図として扱い、null にする。
   */
  async save(
    params: {
      bucket?: string;
      endpoint?: string;
      region?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
    },
    adminId: string,
  ): Promise<void> {
    const existing = await this.db.collectibleImageStorageConfig.findUnique({
      where: { id: IMAGE_STORAGE_CONFIG_ID },
    });

    const secretAccessKeyEncrypted = params.secretAccessKey
      ? encryptSecret(params.secretAccessKey, getEncryptionKey())
      : (existing?.secretAccessKeyEncrypted ?? null);
    const secretAccessKeyPreview = params.secretAccessKey
      ? maskSecret(params.secretAccessKey)
      : (existing?.secretAccessKeyPreview ?? null);

    const data = {
      bucket: normalize(params.bucket, existing?.bucket),
      endpoint: normalize(params.endpoint, existing?.endpoint),
      region: normalize(params.region, existing?.region),
      accessKeyId: normalize(params.accessKeyId, existing?.accessKeyId),
      secretAccessKeyEncrypted,
      secretAccessKeyPreview,
      updatedBy: adminId,
    };

    await this.db.collectibleImageStorageConfig.upsert({
      where: { id: IMAGE_STORAGE_CONFIG_ID },
      create: { id: IMAGE_STORAGE_CONFIG_ID, ...data },
      update: data,
    });
  }
}

/** シークレットまわりの表示。**生値は含めない。** */
function secretView(
  row: { secretAccessKeyEncrypted: string | null; secretAccessKeyPreview: string | null } | null,
  env: NodeJS.ProcessEnv,
) {
  const stored = row?.secretAccessKeyEncrypted ?? null;
  return {
    secretAccessKeySet: stored !== null,
    secretAccessKeyPreview: row?.secretAccessKeyPreview ?? null,
    /** 管理画面未設定でも環境変数で動く状態かどうか。 */
    fallbackFromEnv: stored === null && !!env[ENV_SECRET_ACCESS_KEY],
  };
}

function updateView(row: { updatedAt: Date; updatedBy: string | null } | null) {
  return {
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

/** 未指定なら現状維持、空文字なら未設定へ戻す。 */
function normalize(value: string | undefined, existing: string | null | undefined): string | null {
  if (value === undefined) return existing ?? null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
