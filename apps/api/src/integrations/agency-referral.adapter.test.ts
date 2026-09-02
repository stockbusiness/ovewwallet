import http from "node:http";
import type { AddressInfo } from "node:net";
import { AgencyReferralAdapter } from "./agency-referral.adapter";
import type { IntegrationConfigProvider } from "./integration-config-provider";
import { IntegrationHttpClient } from "./integration-http-client";

/**
 * 代理店システムへ送る登録完了通知 (`POST /api/referrals/confirm`) の本文を、
 * 実際にHTTPで受け取って確認する (`docs/integration/AGENCY_POINT_AWARD.md` 2章)。
 *
 * 連携先が求める項目名 (`referral_token` / `source_system_key` / `source_user_id` /
 * `event_type` / `occurred_at`) と、共通実装契約5章の項目名
 * (`canonical_referral_token` / `system_key` / `external_user_id`) の両方が
 * 揃って出ていくことが、この連携で最初に詰まる箇所なので明示的に固定する。
 */
describe("AgencyReferralAdapter.confirm が送る本文", () => {
  let server: http.Server | undefined;
  let received: Record<string, unknown> | undefined;

  async function startServer(responseBody: unknown): Promise<string> {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(responseBody));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server!.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  afterEach(async () => {
    received = undefined;
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  function buildAdapter(baseUrl: string): AgencyReferralAdapter {
    const configProvider = {
      resolveAgencySystemConfig: async () => ({
        baseUrl,
        systemKey: "orly-wallet",
        apiKey: "test-key",
      }),
    } as unknown as IntegrationConfigProvider;
    return new AgencyReferralAdapter(new IntegrationHttpClient(), configProvider);
  }

  it("sends both the partner's field names and the contract's field names", async () => {
    const baseUrl = await startServer({ status: "confirmed" });
    const adapter = buildAdapter(baseUrl);
    const occurredAt = new Date("2026-09-02T01:00:00.000Z");

    const result = await adapter.confirm({
      referralSessionKey: "rs_abc",
      canonicalReferralToken: "rt_abc",
      commonUserId: "cu_abc",
      walletUserId: "wallet_user_123",
      occurredAt,
    });

    expect(result).toEqual({ status: "confirmed" });
    expect(received).toMatchObject({
      referral_token: "rt_abc",
      canonical_referral_token: "rt_abc",
      referral_session_key: "rs_abc",
      source_system_key: "orly-wallet",
      system_key: "orly-wallet",
      source_user_id: "wallet_user_123",
      external_user_id: "wallet_user_123",
      common_user_id: "cu_abc",
      event_type: "wallet.registration.completed",
      occurred_at: occurredAt.toISOString(),
    });
  });

  it("keeps occurred_at stable across resends by using the registration time", async () => {
    const baseUrl = await startServer({ status: "confirmed" });
    const adapter = buildAdapter(baseUrl);
    const occurredAt = new Date("2026-09-02T01:00:00.000Z");

    await adapter.confirm({
      referralSessionKey: "rs_abc",
      canonicalReferralToken: "rt_abc",
      commonUserId: null,
      walletUserId: "wallet_user_123",
      occurredAt,
    });
    const first = received?.["occurred_at"];

    await adapter.confirm({
      referralSessionKey: "rs_abc",
      canonicalReferralToken: "rt_abc",
      commonUserId: null,
      walletUserId: "wallet_user_123",
      occurredAt,
    });

    expect(received?.["occurred_at"]).toBe(first);
    // common_user_id が未解決のときは、キー自体を送らない (nullを送らない)。
    expect(received).not.toHaveProperty("common_user_id");
  });
});
