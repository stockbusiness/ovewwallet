import { Inject, Injectable } from "@nestjs/common";
import { decryptSecret, encryptSecret } from "@ove/auth";
import type { PrismaClient } from "@ove/database";
import { getEncryptionKey } from "../common/encryption-key";
import { PRISMA } from "../common/prisma.module";

export const MAIL_CONFIG_ID = "default";

export const DEFAULT_MAIL_FROM = "no-reply@sennokuni-wallet.com";

export interface ResolvedMailConfig {
  apiKey: string;
  from: string;
}

/** APIキーの末尾4文字だけを残す (`AdminCommonUserHubService.maskApiKey`と同じ)。 */
export function maskApiKey(key: string): string {
  if (key.length <= 4) return "*".repeat(key.length);
  return `${"*".repeat(key.length - 4)}${key.slice(-4)}`;
}

/**
 * メール送信の設定解決。
 *
 * ## 管理画面 (DB) が環境変数より優先
 *
 * 鍵の入れ替えにデプロイを待たせないため。環境変数 `RESEND_API_KEY` は初期設定と
 * 緊急時の逃げ道として残す (管理画面へ入れるまでの間も送れるように)。
 *
 * ## 毎回読み直す
 *
 * 起動時に固めない。管理画面で鍵を変えた直後から新しい鍵で送れるようにするため。
 * 単一行の主キー検索なので、送信のたびに引いても負荷にならない。
 */
@Injectable()
export class MailConfigService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async resolve(env: NodeJS.ProcessEnv = process.env): Promise<ResolvedMailConfig | null> {
    const row = await this.db.mailConfig.findUnique({ where: { id: MAIL_CONFIG_ID } });

    const apiKey = row?.apiKeyEncrypted
      ? decryptSecret(row.apiKeyEncrypted, getEncryptionKey())
      : env.RESEND_API_KEY;
    if (!apiKey) return null;

    return { apiKey, from: row?.mailFrom || env.MAIL_FROM || DEFAULT_MAIL_FROM };
  }

  async isConfigured(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
    // 鍵の復号までは要らないので、存在確認だけで済ませる。
    const row = await this.db.mailConfig.findUnique({
      where: { id: MAIL_CONFIG_ID },
      select: { apiKeyEncrypted: true },
    });
    return !!row?.apiKeyEncrypted || !!env.RESEND_API_KEY;
  }

  /** 管理画面表示用。生値は返さない。 */
  async describe(env: NodeJS.ProcessEnv = process.env) {
    const row = await this.db.mailConfig.findUnique({ where: { id: MAIL_CONFIG_ID } });
    return {
      apiKeySet: !!row?.apiKeyEncrypted,
      apiKeyPreview: row?.apiKeyPreview ?? null,
      /** 管理画面未設定でも環境変数で送れる状態かどうか。 */
      fallbackFromEnv: !row?.apiKeyEncrypted && !!env.RESEND_API_KEY,
      mailFrom: row?.mailFrom || env.MAIL_FROM || DEFAULT_MAIL_FROM,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  }

  async save(
    params: { apiKey?: string; mailFrom?: string },
    adminId: string,
  ): Promise<void> {
    const existing = await this.db.mailConfig.findUnique({ where: { id: MAIL_CONFIG_ID } });

    // 空欄で保存したときに現在の鍵を消してしまわない (共通顧客HUB設定と同じ挙動)。
    const apiKeyEncrypted = params.apiKey
      ? encryptSecret(params.apiKey, getEncryptionKey())
      : (existing?.apiKeyEncrypted ?? null);
    const apiKeyPreview = params.apiKey ? maskApiKey(params.apiKey) : (existing?.apiKeyPreview ?? null);
    const mailFrom = params.mailFrom ?? existing?.mailFrom ?? null;

    await this.db.mailConfig.upsert({
      where: { id: MAIL_CONFIG_ID },
      create: { id: MAIL_CONFIG_ID, apiKeyEncrypted, apiKeyPreview, mailFrom, updatedBy: adminId },
      update: { apiKeyEncrypted, apiKeyPreview, mailFrom, updatedBy: adminId },
    });
  }
}
