import { encryptSecret } from "@ove/auth";
import { MarketClaimConfigService } from "./market-claim-config.service";

/**
 * この設定は**本番の署名鍵**そのものなので、取り違えると全件が401になる。
 * とくに「DBと環境変数のどちらが使われたか」を取り違えないことが要。
 */
const KEY = "test-only-insecure-encryption-key";

type Row = Record<string, unknown> | null;

function build(row: Row) {
  const writes: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  const db = {
    marketClaimConfig: {
      findUnique: async () => row,
      upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        writes.push(args.update);
        return args.update;
      },
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        audits.push(args.data);
      },
    },
  } as unknown as ConstructorParameters<typeof MarketClaimConfigService>[0];
  return { service: new MarketClaimConfigService(db), writes, audits };
}

const ENV_COMPLETE = {
  SENGOKU_MARKET_CLAIM_BASE_URL: "https://env.example.com",
  SENGOKU_MARKET_CLAIM_KEY_ID: "env-key",
  SENGOKU_MARKET_CLAIM_HMAC_SECRET: "env-secret",
} as NodeJS.ProcessEnv;

describe("MarketClaimConfigService", () => {
  const original = process.env["ENCRYPTION_KEY"];
  beforeEach(() => {
    process.env["ENCRYPTION_KEY"] = KEY;
  });
  afterEach(() => {
    if (original === undefined) delete process.env["ENCRYPTION_KEY"];
    else process.env["ENCRYPTION_KEY"] = original;
  });

  it("DBの行が揃っていれば環境変数より優先する", async () => {
    const { service } = build({
      baseUrl: "https://db.example.com",
      keyId: "db-key",
      hmacSecretEncrypted: encryptSecret("db-secret", KEY),
    });

    const resolved = await service.resolve(ENV_COMPLETE);

    expect(resolved).toEqual({
      baseUrl: "https://db.example.com",
      keyId: "db-key",
      hmacSecret: "db-secret",
    });
  });

  it("DBの行が無ければ環境変数へフォールバックする", async () => {
    const { service } = build(null);

    const resolved = await service.resolve(ENV_COMPLETE);

    expect(resolved).toEqual({
      baseUrl: "https://env.example.com",
      keyId: "env-key",
      hmacSecret: "env-secret",
    });
  });

  /**
   * URLだけDB・鍵だけ環境変数のような混在を許すと、どちらの組で署名したのか
   * 追えなくなる。3点が揃っていないDB行は「未設定」として環境変数へ落とす。
   */
  it("DBの行が欠けていれば混ぜずに環境変数へ落とす", async () => {
    const { service } = build({ baseUrl: "https://db.example.com", keyId: null, hmacSecretEncrypted: null });

    const resolved = await service.resolve(ENV_COMPLETE);

    expect(resolved?.baseUrl).toBe("https://env.example.com");
    expect(resolved?.keyId).toBe("env-key");
  });

  it("どちらも無ければ null を返す (送信自体を行わせない)", async () => {
    const { service } = build(null);

    expect(await service.resolve({} as NodeJS.ProcessEnv)).toBeNull();
  });

  /** `${baseUrl}${path}` で連結するので、末尾スラッシュが残ると `//api/...` になる。 */
  it("ベースURLの末尾スラッシュを落とす", async () => {
    const { service } = build({
      baseUrl: "https://db.example.com/",
      keyId: "db-key",
      hmacSecretEncrypted: encryptSecret("db-secret", KEY),
    });

    expect((await service.resolve(ENV_COMPLETE))?.baseUrl).toBe("https://db.example.com");
  });

  it("表示用には鍵の生値を出さず、末尾4文字だけ見せる", async () => {
    const { service } = build({
      baseUrl: "https://db.example.com",
      keyId: "db-key",
      hmacSecretEncrypted: encryptSecret("db-secret", KEY),
      hmacSecretPreview: "****cret",
      updatedAt: new Date("2026-10-03T00:00:00Z"),
      updatedBy: "admin-1",
    });

    const described = await service.describe(ENV_COMPLETE);

    expect(described.hmacSecretSet).toBe(true);
    expect(described.hmacSecretPreview).toBe("****cret");
    expect(described.configured).toBe(true);
    expect(described.fallbackFromEnv).toBe(false);
    expect(JSON.stringify(described)).not.toContain("db-secret");
  });

  it("DB未設定でも環境変数で動く状態を fallbackFromEnv で伝える", async () => {
    const { service } = build(null);

    const described = await service.describe(ENV_COMPLETE);

    expect(described.hmacSecretSet).toBe(false);
    expect(described.fallbackFromEnv).toBe(true);
    expect(described.configured).toBe(true);
  });

  it("Secretを空欄で保存しても現在の鍵を消さない", async () => {
    const encrypted = encryptSecret("db-secret", KEY);
    const { service, writes } = build({
      baseUrl: "https://db.example.com",
      keyId: "db-key",
      hmacSecretEncrypted: encrypted,
      hmacSecretPreview: "****cret",
    });

    await service.save({ baseUrl: "https://new.example.com" }, "admin-1", "URLのみ変更");

    expect(writes[0]!["hmacSecretEncrypted"]).toBe(encrypted);
    expect(writes[0]!["baseUrl"]).toBe("https://new.example.com");
  });

  it("監査ログに鍵そのものを残さない", async () => {
    const { service, audits } = build(null);

    await service.save(
      { baseUrl: "https://new.example.com", keyId: "k", hmacSecret: "super-secret-value" },
      "admin-1",
      "初期設定",
    );

    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0])).not.toContain("super-secret-value");
    expect(audits[0]!["actionType"]).toBe("MARKET_CLAIM_CONFIG_UPDATED");
  });
});
