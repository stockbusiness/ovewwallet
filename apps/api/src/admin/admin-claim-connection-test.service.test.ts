import type { IntegrationHttpClient } from "../integrations/integration-http-client";
import { AdminClaimConnectionTestService } from "./admin-claim-connection-test.service";

/**
 * この画面の存在理由は「受取ページが全部503にまとめてしまう原因を切り分ける」こと
 * なので、応答の種類ごとに違う結論を出せることを固定する。
 *
 * とくに**404の2通りの意味**(トークンが無い / 経路が無い)を取り違えないことが要。
 * 取り違えると、先方の未実装を「トークンの問題」と誤って案内してしまう。
 */
type Ctor = ConstructorParameters<typeof AdminClaimConnectionTestService>;

const ENV_KEYS = [
  "SENGOKU_MARKET_CLAIM_BASE_URL",
  "SENGOKU_MARKET_CLAIM_KEY_ID",
  "SENGOKU_MARKET_CLAIM_HMAC_SECRET",
] as const;

function build(response: unknown) {
  const audits: Record<string, unknown>[] = [];
  const requests: Record<string, unknown>[] = [];

  const db = {
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        audits.push(args.data);
      },
    },
  } as unknown as Ctor[0];

  const http = {
    request: async (params: Record<string, unknown>) => {
      requests.push(params);
      return response;
    },
  } as unknown as IntegrationHttpClient;

  return { service: new AdminClaimConnectionTestService(db, http), audits, requests };
}

function httpError(status: number, body?: unknown, bodyText?: string) {
  return {
    ok: false,
    error: { kind: "http_4xx", retryable: false, status, message: "failed", body, bodyText },
  };
}

describe("AdminClaimConnectionTestService", () => {
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) original[key] = process.env[key];
    process.env["SENGOKU_MARKET_CLAIM_BASE_URL"] = "https://www.sengoku-rr.com";
    process.env["SENGOKU_MARKET_CLAIM_KEY_ID"] = "key-1";
    process.env["SENGOKU_MARKET_CLAIM_HMAC_SECRET"] = "secret-1";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it("404に契約のエラーコードがあれば「トークンが無い」と判定する (接続と署名は通っている)", async () => {
    const { service } = build(httpError(404, { error: { code: "CLAIM_TOKEN_INVALID" } }));
    const result = await service.run("admin-1", "real-token");

    expect(result.outcome).toBe("token_not_found");
    expect(result.httpStatus).toBe(404);
    expect(result.partnerResponse).toContain("CLAIM_TOKEN_INVALID");
  });

  it("404に契約のエラーコードが無ければ「経路が無い」と判定する", async () => {
    // 先方が状態照会APIを未実装だと、どんなトークンでも素の404になる。
    // これを「トークンの問題」と案内してしまうと、原因にたどり着けない。
    const { service } = build(httpError(404, { message: "Not Found" }));
    const result = await service.run("admin-1", "real-token");

    expect(result.outcome).toBe("endpoint_not_found");
    expect(result.message).toContain("経路自体が無い可能性");
  });

  it("401は署名の問題として、時刻ずれの可能性まで案内する", async () => {
    const { service } = build(httpError(401));
    const result = await service.run("admin-1");

    expect(result.outcome).toBe("unauthorized");
    expect(result.message).toContain("時刻");
  });

  it("接続先が未設定なら送信せずに終える", async () => {
    delete process.env["SENGOKU_MARKET_CLAIM_HMAC_SECRET"];
    const { service, requests, audits } = build(httpError(404));
    const result = await service.run("admin-1");

    expect(result.outcome).toBe("not_configured");
    expect(requests).toHaveLength(0);
    expect(audits).toHaveLength(0);
  });

  it("状態照会 (GET) だけを叩き、確定は叩かない", async () => {
    const { service, requests } = build({ ok: true, data: {} });
    await service.run("admin-1", "tok-1");

    expect(requests).toHaveLength(1);
    expect(requests[0]!["method"]).toBe("GET");
    expect(requests[0]!["path"]).toBe("/api/collectible-claims/tok-1");
    // 確定APIを巻き込むと、テストのつもりで受取を消費してしまう。
    expect(String(requests[0]!["path"])).not.toContain("/confirm");
  });

  it("トークンを省略したらダミーを組み立てて送る", async () => {
    const { service, requests } = build({ ok: true, data: {} });
    await service.run("admin-1");

    expect(String(requests[0]!["path"])).toContain("connection-test-");
  });

  it("監査ログに鍵そのものを残さない", async () => {
    const { service, audits } = build(httpError(401));
    await service.run("admin-1");

    expect(audits).toHaveLength(1);
    const serialized = JSON.stringify(audits[0]);
    expect(serialized).not.toContain("secret-1");
    expect(audits[0]!["actionType"]).toBe("COLLECTIBLE_CLAIM_CONNECTION_TEST");
  });
  /**
   * 2026-09-26 の本番実行で `endpoint_not_found` と出た際、応答が「(本文なし)」と
   * 表示された。`IntegrationHttpClient` はJSONとしてパースできた本文しか `body` に
   * 入れないため、**HTMLの404ページが本文なしに化けていた**のが原因。
   * 判定根拠を画面から確かめられないと、この画面を作った意味が無い。
   */
  it("JSONで無い本文 (HTMLの404ページ) でも中身を画面に出す", async () => {
    const html = "<!DOCTYPE html>\n<html>\n  <head><title>404 Not Found</title></head>\n  <body>nginx</body>\n</html>";
    const { service } = build(httpError(404, undefined, html));
    const result = await service.run("admin-1");

    expect(result.outcome).toBe("endpoint_not_found");
    expect(result.partnerResponse).toContain("404 Not Found");
    expect(result.partnerResponse).toContain("nginx");
    // 改行だらけのHTMLをそのまま出すと画面で読めないので空白は畳む。
    expect(result.partnerResponse).not.toContain("\n");
  });

  it("本文が本当に空なら null のままにする", async () => {
    const { service } = build(httpError(404, undefined, "   \n  "));
    const result = await service.run("admin-1");

    expect(result.outcome).toBe("endpoint_not_found");
    expect(result.partnerResponse).toBeNull();
  });

  /** 生本文へのフォールバックを足したせいで、JSONの判定が鈍らないことを固定する。 */
  it("JSON本文があればそちらを優先して token_not_found と判定する", async () => {
    const { service } = build(
      httpError(404, { code: "CLAIM_TOKEN_INVALID" }, "<html>404</html>"),
    );
    const result = await service.run("admin-1");

    expect(result.outcome).toBe("token_not_found");
    expect(result.partnerResponse).toContain("CLAIM_TOKEN_INVALID");
    expect(result.partnerResponse).not.toContain("<html>");
  });

  it("長すぎる本文は切り詰める", async () => {
    const { service } = build(httpError(404, undefined, "x".repeat(5000)));
    const result = await service.run("admin-1");

    expect(result.partnerResponse).toHaveLength(500);
  });
});
