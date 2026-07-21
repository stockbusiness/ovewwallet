import { assertProductionEnvSafe } from "./assert-production-env";

describe("assertProductionEnvSafe (次期改修指示書P0-6)", () => {
  const complete = {
    NODE_ENV: "production",
    REDIS_URL: "redis://localhost:6379",
    ENCRYPTION_KEY: "a".repeat(32),
    LINE_CHANNEL_ID: "1234567890",
  };

  it("does not throw when all required production env vars are set", () => {
    expect(() => assertProductionEnvSafe(complete)).not.toThrow();
  });

  it("throws listing all missing vars when none are set", () => {
    expect(() => assertProductionEnvSafe({ NODE_ENV: "production" })).toThrow(
      /REDIS_URL.*ENCRYPTION_KEY.*LINE_CHANNEL_ID/,
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

  it("does not throw outside production regardless of missing vars", () => {
    expect(() => assertProductionEnvSafe({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertProductionEnvSafe({ NODE_ENV: "test" })).not.toThrow();
    expect(() => assertProductionEnvSafe({})).not.toThrow();
  });
});
