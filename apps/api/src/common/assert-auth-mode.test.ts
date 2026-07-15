import { assertAuthModeSafeForProduction } from "./assert-auth-mode";

describe("assertAuthModeSafeForProduction (開発ガイドライン12.2章)", () => {
  it("throws when NODE_ENV=production and AUTH_MODE is unset (defaults to mock)", () => {
    expect(() => assertAuthModeSafeForProduction({ NODE_ENV: "production" })).toThrow(/AUTH_MODE=production/);
  });

  it("throws when NODE_ENV=production and AUTH_MODE=mock explicitly", () => {
    expect(() => assertAuthModeSafeForProduction({ NODE_ENV: "production", AUTH_MODE: "mock" })).toThrow();
  });

  it("does not throw when NODE_ENV=production and AUTH_MODE=production", () => {
    expect(() => assertAuthModeSafeForProduction({ NODE_ENV: "production", AUTH_MODE: "production" })).not.toThrow();
  });

  it("does not throw outside production regardless of AUTH_MODE", () => {
    expect(() => assertAuthModeSafeForProduction({ NODE_ENV: "development" })).not.toThrow();
    expect(() => assertAuthModeSafeForProduction({ NODE_ENV: "test", AUTH_MODE: "mock" })).not.toThrow();
    expect(() => assertAuthModeSafeForProduction({})).not.toThrow();
  });
});
