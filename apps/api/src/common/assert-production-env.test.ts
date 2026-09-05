import { assertProductionEnvSafe } from "./assert-production-env";

describe("assertProductionEnvSafe (次期改修指示書P0-6)", () => {
  const complete = {
    NODE_ENV: "production",
    REDIS_URL: "redis://localhost:6379",
    ENCRYPTION_KEY: "a".repeat(32),
    LINE_CHANNEL_ID: "1234567890",
    APP_URL: "https://app.example.com",
    ADMIN_URL: "https://admin.example.com",
  };

  it("does not throw when all required production env vars are set", () => {
    expect(() => assertProductionEnvSafe(complete)).not.toThrow();
  });

  it("throws listing all missing vars when none are set", () => {
    expect(() => assertProductionEnvSafe({ NODE_ENV: "production" })).toThrow(
      /REDIS_URL.*ENCRYPTION_KEY.*LINE_CHANNEL_ID.*APP_URL.*ADMIN_URL/,
    );
  });

  it("throws when only REDIS_URL is missing", () => {
    const { REDIS_URL: _omit, ...rest } = complete;
    expect(() => assertProductionEnvSafe(rest)).toThrow(/REDIS_URL/);
  });

  it("throws when only ENCRYPTION_KEY is missing", () => {
    const { ENCRYPTION_KEY: _omit, ...rest } = complete;
    expect(() => assertProductionEnvSafe(rest)).toThrow(/ENCRYPTION_KEY/);
  });

  it("throws when only LINE_CHANNEL_ID is missing", () => {
    const { LINE_CHANNEL_ID: _omit, ...rest } = complete;
    expect(() => assertProductionEnvSafe(rest)).toThrow(/LINE_CHANNEL_ID/);
  });

  // APP_URL/ADMIN_URLはCORSとCSRF対策が共有する許可オリジン一覧の唯一の入力のため、
  // 本番で未設定のまま起動させない (csrf-protection.middleware.ts参照)。
  it("throws when only APP_URL is missing", () => {
    const { APP_URL: _omit, ...rest } = complete;
    expect(() => assertProductionEnvSafe(rest)).toThrow(/APP_URL/);
  });

  it("throws when only ADMIN_URL is missing", () => {
    const { ADMIN_URL: _omit, ...rest } = complete;
    expect(() => assertProductionEnvSafe(rest)).toThrow(/ADMIN_URL/);
  });

  // メールログインを開けたのに送信設定が無いと、画面にボタンは出るのにコードが
  // 誰にも届かないという最も原因の掴みにくい壊れ方をする (docs/login-methods.md)。
  it("throws when email login is enabled without a mail delivery key", () => {
    expect(() => assertProductionEnvSafe({ ...complete, ENABLE_EMAIL_LOGIN: "true" })).toThrow(
      /RESEND_API_KEY/,
    );
  });

  it("does not require a mail delivery key while email login stays closed", () => {
    expect(() => assertProductionEnvSafe(complete)).not.toThrow();
    expect(() => assertProductionEnvSafe({ ...complete, ENABLE_EMAIL_LOGIN: "false" })).not.toThrow();
  });

  it("accepts email login once the mail delivery key is set", () => {
    expect(() =>
      assertProductionEnvSafe({ ...complete, ENABLE_EMAIL_LOGIN: "true", RESEND_API_KEY: "re_x" }),
    ).not.toThrow();
  });

  it("does not throw outside production regardless of missing vars", () => {
    expect(() => assertProductionEnvSafe({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertProductionEnvSafe({ NODE_ENV: "test" })).not.toThrow();
    expect(() => assertProductionEnvSafe({})).not.toThrow();
  });
});
