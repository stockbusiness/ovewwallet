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

  /**
   * NFTカードClaim導線実装指示書向けの拡張回帰テスト。単一のAPIキーヘッダーではなく
   * HMAC複数ヘッダー(X-SenNoKuni-*)で認証する`SengokuMarketClaimAdapter`のために、
   * `apiKey`を省略可能にし`extraHeaders`を追加した。
   */
  it("sends extraHeaders and omits the API key header when apiKey is not provided", async () => {
    let receivedHeaders: http.IncomingHttpHeaders = {};
    const baseUrl = await startServer((req, res) => {
      receivedHeaders = req.headers;
      res.statusCode = 200;
      res.end();
    });

    const result = await client.request({
      baseUrl,
      path: "/x",
      extraHeaders: { "x-sennokuni-signature": "sig-value", "x-sennokuni-key-id": "key-1" },
    });

    expect(result.ok).toBe(true);
    expect(receivedHeaders["x-sennokuni-signature"]).toBe("sig-value");
    expect(receivedHeaders["x-sennokuni-key-id"]).toBe("key-1");
    expect(receivedHeaders["x-api-key"]).toBeUndefined();
  });

  it("parses the JSON body of a non-ok response so callers can sub-classify by an application-level error code", async () => {
    const baseUrl = await startServer((_req, res) => {
      res.statusCode = 409;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ code: "processing" }));
    });

    const result = await client.request({ baseUrl, path: "/x", apiKey: "k" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(409);
      expect(result.error.body).toEqual({ code: "processing" });
    }
  });
  /**
   * 2026-09-27、千ノ国マーケットのClaim接続調査でワイヤーを実測したところ
   * `x-correlation-id: corr-1, corr-1` と**連結**されていた。`extraHeaders`が
   * 同名を持つのに、あとから同じヘッダーを重ねていたのが原因 (RFC 9110 5.2)。
   * 署名関連ヘッダーを厳密に検証する連携先はこれを不正値として弾きうる。
   */
  it("does not duplicate a header the caller already set via extraHeaders", async () => {
    let receivedHeaders: Record<string, string | string[] | undefined> = {};
    const baseUrl = await startServer((req, res) => {
      receivedHeaders = req.headers;
      res.statusCode = 200;
      res.end();
    });

    await client.request({
      baseUrl,
      path: "/x",
      extraHeaders: { "X-Correlation-Id": "corr-1", "X-Request-Id": "req-1" },
      correlationId: "corr-generated",
    });

    expect(receivedHeaders["x-correlation-id"]).toBe("corr-1");
    expect(receivedHeaders["x-request-id"]).toBe("req-1");
  });

  it("still sets correlation and request ids when the caller passes none", async () => {
    let receivedHeaders: Record<string, string | string[] | undefined> = {};
    const baseUrl = await startServer((req, res) => {
      receivedHeaders = req.headers;
      res.statusCode = 200;
      res.end();
    });

    await client.request({ baseUrl, path: "/x", correlationId: "corr-2" });

    expect(receivedHeaders["x-correlation-id"]).toBe("corr-2");
    expect(receivedHeaders["x-request-id"]).toEqual(expect.any(String));
  });

  /** JSONとしてパースできない本文は`body`に入らないので、生本文も別に保持する。 */
  it("keeps the raw body of a non-ok response even when it is not JSON", async () => {
    const baseUrl = await startServer((_req, res) => {
      res.statusCode = 404;
      res.setHeader("content-type", "text/html");
      res.end("<html><title>404 Not Found</title></html>");
    });

    const result = await client.request({ baseUrl, path: "/x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.body).toBeUndefined();
      expect(result.error.bodyText).toContain("404 Not Found");
    }
  });
  /**
   * 2026-10-03、Claimの署名不一致調査。鍵も canonical string も双方一致したのに
   * 401が続いた。署名は**要求時のパス**に対して計算するため、途中で301/302が
   * 挟まると連携先アプリが見るパスとずれる。どちらからも見えない失敗なので、
   * 最終URLを結果に残して検知できるようにする。
   */
  it("reports the final URL and redirect flag so a path-changing redirect is visible", async () => {
    const baseUrl = await startServer((req, res) => {
      if (req.url === "/x") {
        res.statusCode = 301;
        res.setHeader("location", "/moved");
        res.end();
        return;
      }
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { code: "INVALID_SIGNATURE" } }));
    });

    const result = await client.request({ baseUrl, path: "/x" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.redirected).toBe(true);
      expect(result.error.finalUrl).toContain("/moved");
    }
  });

  it("marks a direct response as not redirected", async () => {
    const baseUrl = await startServer((_req, res) => {
      res.statusCode = 401;
      res.end();
    });

    const result = await client.request({ baseUrl, path: "/x" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.redirected).toBe(false);
      expect(result.error.finalUrl).toContain("/x");
    }
  });
  /**
   * 2026-10-03、Claimの署名不一致調査。鍵の指紋もcanonical stringも連携先と一致し、
   * リダイレクトも無いのに401が続いた。残る容疑が「空の本文の解釈」。
   *
   * GETに `content-type: application/json` が付いていると、連携先のbodyパーサが
   * 空の本文を `{}` と解釈しうる。署名の `raw_body` を `JSON.stringify(req.body)` で
   * 組み立てる実装では、こちらが空文字で署名しているのに相手は `{}` で検証することに
   * なり、**双方の照合は一致するのに実リクエストだけ落ちる**。本文が無いなら
   * content-type も付けないのが正しい。
   */
  it("omits content-type when the request has no body", async () => {
    let receivedHeaders: Record<string, string | string[] | undefined> = {};
    const baseUrl = await startServer((req, res) => {
      receivedHeaders = req.headers;
      res.statusCode = 200;
      res.end();
    });

    await client.request({ baseUrl, path: "/x", method: "GET" });

    expect(receivedHeaders["content-type"]).toBeUndefined();
  });

  it("still sends content-type when there is a body", async () => {
    let receivedHeaders: Record<string, string | string[] | undefined> = {};
    let receivedBody = "";
    const baseUrl = await startServer((req, res) => {
      receivedHeaders = req.headers;
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        receivedBody = Buffer.concat(chunks).toString("utf8");
        res.statusCode = 200;
        res.end();
      });
    });

    await client.request({ baseUrl, path: "/x", method: "POST", body: { a: 1 } });

    expect(receivedHeaders["content-type"]).toBe("application/json");
    expect(receivedBody).toBe('{"a":1}');
  });

  /** `rawBody` に空文字を明示した場合は本文ありとして扱う (署名対象と送信を一致させるため)。 */
  it("sends content-type when the caller explicitly passes an empty rawBody", async () => {
    let receivedHeaders: Record<string, string | string[] | undefined> = {};
    const baseUrl = await startServer((req, res) => {
      receivedHeaders = req.headers;
      res.statusCode = 200;
      res.end();
    });

    await client.request({ baseUrl, path: "/x", method: "POST", rawBody: "" });

    expect(receivedHeaders["content-type"]).toBe("application/json");
  });
});
