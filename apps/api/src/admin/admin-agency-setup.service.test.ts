import { AdminAgencySetupService } from "./admin-agency-setup.service";

/**
 * 代理店連携セットアップ画面が読む状態のまとめ方を固定する。
 *
 * 特に `system_key` は、既定値の `ove-wallet` のままだと代理店システム側の登録値と
 * 一致せず登録完了通知が弾かれる (`docs/integration/AGENCY_POINT_AWARD.md`)。
 * 画面上「未完了」と出せることがこの機能の要点なので、判定をテストで固定する。
 */
type PrismaStub = ConstructorParameters<typeof AdminAgencySetupService>[0];

function buildService(overrides: {
  hubConfig?: Record<string, unknown> | null;
  integration?: Record<string, unknown> | null;
  referrals?: { status: string; _count: { _all: number } }[];
  links?: { status: string; _count: { _all: number } }[];
}) {
  const db = {
    commonUserHubConfig: { findFirst: async () => overrides.hubConfig ?? null },
    serviceIntegration: { findUnique: async () => overrides.integration ?? null },
    walletReferral: { groupBy: async () => overrides.referrals ?? [] },
    accountLink: { groupBy: async () => overrides.links ?? [] },
  } as unknown as PrismaStub;
  return new AdminAgencySetupService(db);
}

describe("AdminAgencySetupService", () => {
  // process.env ごと差し替えると、--runInBand で同じプロセスを共有する他のテスト
  // ファイルにまで影響しうる。触ったキーだけを元に戻す。
  const touchedKeys = AdminAgencySetupService.REQUIRED_FLAGS;
  let saved: Partial<Record<(typeof touchedKeys)[number], string | undefined>> = {};

  beforeEach(() => {
    saved = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));
  });

  afterEach(() => {
    for (const key of touchedKeys) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("system_key が未設定なら既定の ove-wallet 扱いで、期待値と不一致と判定する", async () => {
    const result = await buildService({ hubConfig: null }).get();

    expect(result.systemKey.current).toBe("ove-wallet");
    expect(result.systemKey.expected).toBe("orly-wallet");
    expect(result.systemKey.matches).toBe(false);
  });

  it("system_key が orly-wallet なら一致と判定する", async () => {
    const result = await buildService({ hubConfig: { systemKey: "orly-wallet" } }).get();

    expect(result.systemKey.matches).toBe(true);
  });

  it("受信用APIキーは、発行済みかどうかと相手が実際に使ったかを返す", async () => {
    const issuedAt = new Date("2026-09-01T00:00:00.000Z");
    const lastAccessedAt = new Date("2026-09-04T00:00:00.000Z");
    const result = await buildService({
      integration: { id: "svc_1", status: "ACTIVE", createdAt: issuedAt, lastAccessedAt },
    }).get();

    expect(result.inboundApiKey).toEqual({
      issued: true,
      status: "ACTIVE",
      issuedAt,
      lastAccessedAt,
    });
  });

  it("受信用APIキーが未発行なら issued: false を返す", async () => {
    const result = await buildService({ integration: null }).get();

    expect(result.inboundApiKey.issued).toBe(false);
    expect(result.inboundApiKey.lastAccessedAt).toBeNull();
  });

  it("必要なFeature Flagだけを、未設定はfalseとして返す", async () => {
    process.env.ENABLE_PLATFORM_USER_ID = "true";
    process.env.ENABLE_AGENCY_REFERRAL_SYNC = "true";
    delete process.env.ENABLE_WALLET_REFERRAL_TOKEN;
    delete process.env.ENABLE_AGENCY_POINT_AWARD_INBOX;

    const result = await buildService({}).get();

    expect(result.flags).toEqual({
      ENABLE_PLATFORM_USER_ID: true,
      ENABLE_WALLET_REFERRAL_TOKEN: false,
      ENABLE_AGENCY_REFERRAL_SYNC: true,
      ENABLE_AGENCY_POINT_AWARD_INBOX: false,
    });
  });

  it("紹介と代理店紐付けの件数を状態ごとに返す", async () => {
    const result = await buildService({
      referrals: [
        { status: "CAPTURED", _count: { _all: 3 } },
        { status: "CONFIRMED", _count: { _all: 1 } },
      ],
      links: [{ status: "PENDING", _count: { _all: 2 } }],
    }).get();

    expect(result.referrals).toEqual({ CAPTURED: 3, CONFIRMED: 1 });
    expect(result.agencyLinks).toEqual({ PENDING: 2 });
  });
});
