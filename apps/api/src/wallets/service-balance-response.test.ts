import { buildCommonUserBalanceResponse } from "./service-balance-response";

describe("buildCommonUserBalanceResponse (PR-W2, Clock固定テスト)", () => {
  it("固定したDateをas_ofへそのままISO 8601で反映する", () => {
    const fixedNow = new Date("2026-08-20T12:34:56.789Z");

    const response = buildCommonUserBalanceResponse(
      {
        status: "ACTIVE",
        availableBalance: "3000",
        pendingBalance: "0",
        heldBalance: "0",
        lifetimeCredited: "3000",
        lifetimeDebited: "0",
      },
      fixedNow,
    );

    expect(response.as_of).toBe("2026-08-20T12:34:56.789Z");
  });

  it("金額項目は文字列型のまま、currency/data_status/wallet_statusが付与される", () => {
    const response = buildCommonUserBalanceResponse(
      {
        status: "RESTRICTED",
        availableBalance: "1500",
        pendingBalance: "200",
        heldBalance: "0",
        lifetimeCredited: "1700",
        lifetimeDebited: "0",
      },
      new Date("2026-08-20T00:00:00.000Z"),
    );

    expect(typeof response.available_balance).toBe("string");
    expect(typeof response.pending_balance).toBe("string");
    expect(typeof response.held_balance).toBe("string");
    expect(typeof response.lifetime_credited).toBe("string");
    expect(typeof response.lifetime_debited).toBe("string");
    expect(response.currency).toBe("OVE");
    expect(response.data_status).toBe("ok");
    expect(response.wallet_status).toBe("RESTRICTED");
  });

  it("common_user_id/account_id/wallet_id等の内部識別子を含まない", () => {
    const response = buildCommonUserBalanceResponse(
      {
        status: "ACTIVE",
        availableBalance: "0",
        pendingBalance: "0",
        heldBalance: "0",
        lifetimeCredited: "0",
        lifetimeDebited: "0",
      },
      new Date(),
    );

    const keys = Object.keys(response);
    expect(keys).not.toContain("common_user_id");
    expect(keys).not.toContain("account_id");
    expect(keys).not.toContain("ove_account_id");
    expect(keys).not.toContain("wallet_id");
    expect(keys).not.toContain("wallet_code");
  });
});
