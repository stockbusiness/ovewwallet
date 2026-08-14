import http from "node:http";
import type { AddressInfo } from "node:net";
import { hmacSign } from "@ove/auth";
import { IntegrationHttpClient } from "./integration-http-client";
import {
  SengokuMarketClaimAdapter,
  buildSenNoKuniCanonicalString,
  signSenNoKuniRequest,
} from "./sengoku-market-claim.adapter";

/**
 * 千ノ国NFTマーケット契約v2指示書 PR-WN01 (6〜9章) の回帰テスト。
 *
 * 指示書9章の「NFTマーケット正式vector」は、開発者確認により入力値
 * (key_id/secret/timestamp/nonce/method/path/raw_body) が判明したため、
 * 下記「NFTマーケット正式固定vector (指示書9章)」ブロックで完全一致を検証する。
 * `test-secret`は固定テスト専用値であり、staging/productionのHMAC Secretとは別。
 */
describe("sengoku-market-claim.adapter (千ノ国NFTマーケット契約v2 PR-WN01)", () => {
  describe("buildSenNoKuniCanonicalString", () => {
    it("joins key_id/timestamp/nonce/METHOD/path/raw_body with LF, uppercasing method and stripping query", () => {
      const canonical = buildSenNoKuniCanonicalString({
        keyId: "test-key-001",
        timestamp: "1784691600",
        nonce: "nonce-1",
        method: "post",
        path: "/api/collectible-claims/tok123/confirm?foo=bar",
        rawBody: '{"common_user_id":"cu_1"}',
      });

      expect(canonical).toBe(
        [
          "test-key-001",
          "1784691600",
          "nonce-1",
          "POST",
          "/api/collectible-claims/tok123/confirm",
          '{"common_user_id":"cu_1"}',
        ].join("\n"),
      );
    });

    it("uses an empty string as raw_body for GET requests", () => {
      const canonical = buildSenNoKuniCanonicalString({
        keyId: "k",
        timestamp: "1",
        nonce: "n",
        method: "GET",
        path: "/api/collectible-claims/tok123",
        rawBody: "",
      });

      expect(canonical.endsWith("\n")).toBe(true);
      expect(canonical).toBe(["k", "1", "n", "GET", "/api/collectible-claims/tok123", ""].join("\n"));
    });
  });

  describe("signSenNoKuniRequest", () => {
    it("prefixes the hex HMAC with sha256= without changing the underlying hmacSign() behavior", () => {
      const secret = "test-secret";
      const canonical = "a\nb\nc";
      const signature = signSenNoKuniRequest(secret, canonical);

      expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
      expect(signature).toBe(`sha256=${hmacSign(secret, canonical)}`);
    });
  });

  /** 千ノ国NFTマーケット正式固定vector (指示書9章、開発者確認済みの入力値)。 */
  describe("NFTマーケット正式固定vector (指示書9章)", () => {
    it("matches the official POST vector", () => {
      const canonical = buildSenNoKuniCanonicalString({
        keyId: "test-key-001",
        timestamp: "1786660000",
        nonce: "nonce-fixed-001",
        method: "POST",
        path: "/api/collectible-claims/test-token/confirm",
        rawBody: '{"common_user_id":"cu_0123456789abcdef0123456789abcdef"}',
      });

      expect(signSenNoKuniRequest("test-secret", canonical)).toBe(
        "sha256=5d5dff59f51f7de3df54b541eb636e47b91cde8a0a79ccaccfcf34c0c28f9fe1",
      );
    });

    it("matches the official GET vector", () => {
      const canonical = buildSenNoKuniCanonicalString({
        keyId: "test-key-001",
        timestamp: "1786660000",
        nonce: "nonce-fixed-002",
        method: "GET",
        path: "/api/collectible-claims/test-token",
        rawBody: "",
      });

      expect(signSenNoKuniRequest("test-secret", canonical)).toBe(
        "sha256=2b059e010615116377299b3526bf20e33161ad9c1cbce4ee552eb38a55e269ec",
      );
    });
  });

  describe("SengokuMarketClaimAdapter outbound requests", () => {
    let server: http.Server | undefined;
    let receivedBody = "";
    let receivedHeaders: http.IncomingHttpHeaders = {};

    async function startServer(statusCode: number, body: unknown): Promise<string> {
      server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          receivedBody = Buffer.concat(chunks).toString("utf8");
          receivedHeaders = req.headers;
          res.writeHead(statusCode, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        });
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const { port } = server.address() as AddressInfo;
      return `http://127.0.0.1:${port}`;
    }

    afterEach(async () => {
      if (server) {
        await new Promise<void>((resolve) => server!.close(() => resolve()));
        server = undefined;
      }
      delete process.env.ENABLE_COLLECTIBLE_CLAIM_FLOW;
      delete process.env.SENGOKU_MARKET_CLAIM_BASE_URL;
      delete process.env.SENGOKU_MARKET_CLAIM_KEY_ID;
      delete process.env.SENGOKU_MARKET_CLAIM_HMAC_SECRET;
    });

    it("signs confirmClaim() using the exact same raw body bytes it sends (no double JSON.stringify drift)", async () => {
      const baseUrl = await startServer(200, { status: "DELIVERY_PENDING" });
      process.env.ENABLE_COLLECTIBLE_CLAIM_FLOW = "true";
      process.env.SENGOKU_MARKET_CLAIM_BASE_URL = baseUrl;
      process.env.SENGOKU_MARKET_CLAIM_KEY_ID = "test-claim-key";
      process.env.SENGOKU_MARKET_CLAIM_HMAC_SECRET = "test-claim-secret";

      const adapter = new SengokuMarketClaimAdapter(new IntegrationHttpClient());
      const result = await adapter.confirmClaim({
        rawToken: "tok123",
        commonUserId: "cu_1",
        idempotencyKey: "idem-1",
      });

      expect(result.outcome).toBe("accepted");
      expect(receivedBody).toBe(JSON.stringify({ common_user_id: "cu_1" }));

      const keyId = receivedHeaders["x-sennokuni-key-id"];
      const timestamp = receivedHeaders["x-sennokuni-timestamp"];
      const nonce = receivedHeaders["x-sennokuni-nonce"];
      const signature = receivedHeaders["x-sennokuni-signature"];
      expect(typeof keyId).toBe("string");
      expect(typeof timestamp).toBe("string");
      expect(typeof nonce).toBe("string");
      expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
      expect(receivedHeaders["idempotency-key"]).toBe("idem-1");

      // サーバーが受け取った生ボディで独立に署名を再計算し、送信された署名と一致することを確認する
      // (署名対象とHTTP送信バイト列が実際に同一であることの直接証拠)。
      const expectedCanonical = buildSenNoKuniCanonicalString({
        keyId: keyId as string,
        timestamp: timestamp as string,
        nonce: nonce as string,
        method: "POST",
        path: "/api/collectible-claims/tok123/confirm",
        rawBody: receivedBody,
      });
      expect(signature).toBe(signSenNoKuniRequest("test-claim-secret", expectedCanonical));
    });

    it("treats a 202 with reason=common_user_pending as market_common_user_pending, not accepted (契約v2指示書11章)", async () => {
      const baseUrl = await startServer(202, { status: "PENDING", reason: "common_user_pending" });
      process.env.ENABLE_COLLECTIBLE_CLAIM_FLOW = "true";
      process.env.SENGOKU_MARKET_CLAIM_BASE_URL = baseUrl;
      process.env.SENGOKU_MARKET_CLAIM_KEY_ID = "test-claim-key";
      process.env.SENGOKU_MARKET_CLAIM_HMAC_SECRET = "test-claim-secret";

      const adapter = new SengokuMarketClaimAdapter(new IntegrationHttpClient());
      const result = await adapter.confirmClaim({
        rawToken: "tok123",
        commonUserId: "cu_1",
        idempotencyKey: "idem-1",
      });

      expect(result.outcome).toBe("market_common_user_pending");
    });

    it.each([
      ["COMMON_USER_MISMATCH", "common_user_mismatch"],
      ["CLAIM_REVOKED", "revoked"],
      ["CLAIM_EXPIRED", "expired"],
      ["CLAIM_NOT_FOUND", "not_found"],
      ["IDEMPOTENCY_IN_PROGRESS", "processing"],
      ["IDEMPOTENCY_CONFLICT", "idempotency_conflict"],
    ] as const)(
      "classifies the new Market standard error envelope {error:{code:%s}} as outcome=%s (契約v2指示書10.1章)",
      async (marketCode, expectedOutcome) => {
        const baseUrl = await startServer(409, { error: { code: marketCode, message: "test" } });
        process.env.ENABLE_COLLECTIBLE_CLAIM_FLOW = "true";
        process.env.SENGOKU_MARKET_CLAIM_BASE_URL = baseUrl;
        process.env.SENGOKU_MARKET_CLAIM_KEY_ID = "test-claim-key";
        process.env.SENGOKU_MARKET_CLAIM_HMAC_SECRET = "test-claim-secret";

        const adapter = new SengokuMarketClaimAdapter(new IntegrationHttpClient());
        const result = await adapter.confirmClaim({
          rawToken: "tok123",
          commonUserId: "cu_1",
          idempotencyKey: "idem-1",
        });

        expect(result.outcome).toBe(expectedOutcome);
      },
    );

    it("signs getClaimStatus() (GET) with an empty raw body", async () => {
      const baseUrl = await startServer(200, { status: "PENDING" });
      process.env.ENABLE_COLLECTIBLE_CLAIM_FLOW = "true";
      process.env.SENGOKU_MARKET_CLAIM_BASE_URL = baseUrl;
      process.env.SENGOKU_MARKET_CLAIM_KEY_ID = "test-claim-key";
      process.env.SENGOKU_MARKET_CLAIM_HMAC_SECRET = "test-claim-secret";

      const adapter = new SengokuMarketClaimAdapter(new IntegrationHttpClient());
      const result = await adapter.getClaimStatus("tok123");

      expect(result.outcome).toBe("ok");
      expect(receivedBody).toBe("");

      const keyId = receivedHeaders["x-sennokuni-key-id"] as string;
      const timestamp = receivedHeaders["x-sennokuni-timestamp"] as string;
      const nonce = receivedHeaders["x-sennokuni-nonce"] as string;
      const signature = receivedHeaders["x-sennokuni-signature"];

      const expectedCanonical = buildSenNoKuniCanonicalString({
        keyId,
        timestamp,
        nonce,
        method: "GET",
        path: "/api/collectible-claims/tok123",
        rawBody: "",
      });
      expect(signature).toBe(signSenNoKuniRequest("test-claim-secret", expectedCanonical));
    });
  });
});
