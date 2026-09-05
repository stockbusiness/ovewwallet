import { encryptSecret } from "@ove/auth";
import type { PrismaClient } from "@ove/database";
import { getEncryptionKey } from "../common/encryption-key";
import { DEFAULT_MAIL_FROM, MailConfigService, maskApiKey } from "./mail-config.service";

type Row = {
  apiKeyEncrypted: string | null;
  apiKeyPreview: string | null;
  mailFrom: string | null;
  updatedAt: Date;
  updatedBy: string | null;
};

/** DBを立てずに解決順序だけを確かめる。単一行の主キー検索しか使わないので差し替えで足りる。 */
function serviceWith(row: Row | null): MailConfigService {
  const db = {
    mailConfig: { findUnique: async () => row },
  } as unknown as PrismaClient;
  return new MailConfigService(db);
}

function encrypted(key: string): string {
  return encryptSecret(key, getEncryptionKey());
}

describe("メール送信設定の解決", () => {
  it("管理画面の鍵が環境変数より優先される (入れ替えにデプロイを待たせない)", async () => {
    const service = serviceWith({
      apiKeyEncrypted: encrypted("re_from_admin"),
      apiKeyPreview: "****min",
      mailFrom: "admin@example.com",
      updatedAt: new Date(),
      updatedBy: "admin-1",
    });

    const resolved = await service.resolve({ RESEND_API_KEY: "re_from_env", MAIL_FROM: "env@example.com" });
    expect(resolved).toEqual({ apiKey: "re_from_admin", from: "admin@example.com" });
  });

  it("管理画面が未設定なら環境変数へ落ちる (初期設定と緊急時の逃げ道)", async () => {
    const resolved = await serviceWith(null).resolve({ RESEND_API_KEY: "re_from_env" });
    expect(resolved).toEqual({ apiKey: "re_from_env", from: DEFAULT_MAIL_FROM });
  });

  it("どちらにも無ければ未設定として返す", async () => {
    expect(await serviceWith(null).resolve({})).toBeNull();
  });

  it("差出人だけ管理画面にあれば、環境変数の鍵と組み合わせる", async () => {
    const service = serviceWith({
      apiKeyEncrypted: null,
      apiKeyPreview: null,
      mailFrom: "admin@example.com",
      updatedAt: new Date(),
      updatedBy: null,
    });
    const resolved = await service.resolve({ RESEND_API_KEY: "re_from_env" });
    expect(resolved).toEqual({ apiKey: "re_from_env", from: "admin@example.com" });
  });

  it("設定済みかの判定は鍵を復号せずに行う", async () => {
    expect(await serviceWith(null).isConfigured({})).toBe(false);
    expect(await serviceWith(null).isConfigured({ RESEND_API_KEY: "re_x" })).toBe(true);
  });

  it("管理画面表示では、環境変数で送れている状態が分かる", async () => {
    const described = await serviceWith(null).describe({ RESEND_API_KEY: "re_x" });
    expect(described.apiKeySet).toBe(false);
    expect(described.fallbackFromEnv).toBe(true);
  });
});

describe("APIキーのマスク", () => {
  it("末尾4文字だけを残す", () => {
    expect(maskApiKey("re_secret_abcd")).toBe("**********abcd");
  });

  it("4文字以下なら全て伏せる", () => {
    expect(maskApiKey("abcd")).toBe("****");
    expect(maskApiKey("ab")).toBe("**");
  });
});
