import http from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { IntegrationHttpClient } from "./integration-http-client";

/**
 * リファクタリング指示書 Phase 7「外部HTTP基盤」の回帰テスト。旧`CommonUserHubClient`/
 * `AgencyReferralClient`にはtimeout/AbortControllerが一切無く、外部システムが応答を
 * 返さない場合は呼び出しが無期限にハングしていた。`IntegrationHttpClient`導入により
 * この欠落を解消したことと、エラー種別(timeout/network/http_4xx/http_5xx/invalid_response)
 * ・リトライ対象判定が期待通りに分類されることを検証する。
 */
describe("IntegrationHttpClient", () => {
  const client = new IntegrationHttpClient();
  let server: http.Server | undefined;

  async function startServer(handler: http.RequestListener): Promise<string> {
    server = http.createServer(handler);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
  });

  it("classifies a slow/unresponsive server as a retryable timeout instead of hanging forever", async () => {
    const baseUrl = await startServer(() => {
      // レスポンスを一切返さない (旧実装ならここで無期限にハングしていた)。
    });

    const result = await client.request({
      baseUrl,
      path: "/never-responds",
      apiKey: "test-key",
      timeoutMs: 100,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("timeout");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("classifies a connection failure (unreachable host) as retryable network error", async () => {
    const result = await client.request({
      baseUrl: "http://127.0.0.1:1", // 即座に接続拒否されるポート
      path: "/x",
      apiKey: "test-key",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("network");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("classifies HTTP 5xx as retryable, HTTP 4xx as non-retryable", async () => {
    const baseUrl = await startServer((req, res) => {
      res.statusCode = req.url === "/server-error" ? 503 : 400;
      res.end();
    });

    const serverError = await client.request({ baseUrl, path: "/server-error", apiKey: "k" });
    expect(serverError.ok).toBe(false);
    if (!serverError.ok) {
      expect(serverError.error.kind).toBe("http_5xx");
      expect(serverError.error.retryable).toBe(true);
      expect(serverError.error.status).toBe(503);
    }

    const clientError = await client.request({ baseUrl, path: "/bad-request", apiKey: "k" });
    expect(clientError.ok).toBe(false);
    if (!clientError.ok) {
      expect(clientError.error.kind).toBe("http_4xx");
      expect(clientError.error.retryable).toBe(false);
      expect(clientError.error.status).toBe(400);
    }
  });

  it("validates the response body against the given Zod schema and rejects a non-matching shape", async () => {
    const baseUrl = await startServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ unexpected: "shape" }));
    });

    const result = await client.request({
      baseUrl,
      path: "/x",
      apiKey: "k",
      responseSchema: z.object({ common_user_id: z.string() }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_response");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("returns the parsed, schema-validated data on success", async () => {
    const baseUrl = await startServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ common_user_id: "cu_123", extra_unknown_field: "ignored" }));
    });

    const result = await client.request({
      baseUrl,
      path: "/x",
      apiKey: "k",
      responseSchema: z.object({ common_user_id: z.string() }),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.common_user_id).toBe("cu_123");
    }
  });

  it("treats HTTP 200 with no responseSchema as success without reading the body (旧linkSystemAccountの挙動と同一)", async () => {
    const baseUrl = await startServer((_req, res) => {
      res.statusCode = 200;
      res.end(); // 空ボディ。responseSchema省略時はres.json()を呼ばないため壊れない。
    });

    const result = await client.request({ baseUrl, path: "/x", apiKey: "k" });
    expect(result.ok).toBe(true);
  });

  it("never leaks the raw API key in a failure result", async () => {
    const baseUrl = await startServer((_req, res) => {
      res.statusCode = 400;
      res.end();
    });

    const result = await client.request({ baseUrl, path: "/x", apiKey: "super-secret-raw-key" });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("super-secret-raw-key");
  });
});
