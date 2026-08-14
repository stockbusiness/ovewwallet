import { randomUUID } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { hmacSign } from "@ove/auth";
import { isFeatureEnabled } from "../common/feature-flags";
import { IntegrationHttpClient, type IntegrationErrorResult } from "./integration-http-client";
import {
  MarketClaimConfirmResponseSchema,
  MarketClaimErrorBodySchema,
  MarketClaimStatusResponseSchema,
  type MARKET_CLAIM_STATUS_VALUES,
} from "./integration-response-schemas";

export type MarketClaimStatus = (typeof MARKET_CLAIM_STATUS_VALUES)[number];

export type GetClaimStatusResult =
  | { outcome: "ok"; status: MarketClaimStatus; cardName: string | null; expiresAt: string | null }
  | { outcome: "not_found" }
  | { outcome: "expired" }
  | { outcome: "disabled" }
  | { outcome: "timeout" }
  | { outcome: "network_error" }
  | { outcome: "invalid_response" };

export type ConfirmClaimResult =
  | { outcome: "accepted"; status: string }
  | { outcome: "not_found" }
  | { outcome: "expired" }
  | { outcome: "revoked" }
  | { outcome: "common_user_mismatch" }
  | { outcome: "processing" }
  | { outcome: "disabled" }
  | { outcome: "timeout" }
  | { outcome: "network_error" }
  | { outcome: "invalid_response" };

interface MarketClaimConfig {
  baseUrl: string;
  keyId: string;
  hmacSecret: string;
}

/**
 * NFTカードClaim導線実装指示書7章。Feature Flag OFF、またはbaseUrl/keyId/secretの
 * いずれかが未設定なら`null` (呼び出し元は503 disabled/config missingとして扱う)。
 * 代理店システム連携の`IntegrationConfigProvider`と異なり、この設定はDBではなく
 * 環境変数から読む (指示書7章が明示するプレーンな環境変数のみの構成)。
 */
function resolveMarketClaimConfig(): MarketClaimConfig | null {
  if (!isFeatureEnabled("ENABLE_COLLECTIBLE_CLAIM_FLOW")) return null;
  const baseUrl = process.env["SENGOKU_MARKET_CLAIM_BASE_URL"];
  const keyId = process.env["SENGOKU_MARKET_CLAIM_KEY_ID"];
  const hmacSecret = process.env["SENGOKU_MARKET_CLAIM_HMAC_SECRET"];
  if (!baseUrl || !keyId || !hmacSecret) return null;
  return { baseUrl, keyId, hmacSecret };
}

/**
 * 千ノ国NFTマーケット契約v2指示書6〜7章のcanonical string。
 * `key_id + "\n" + timestamp + "\n" + nonce + "\n" + METHOD + "\n" + path(query除く) + "\n" + raw_body`
 * (LF区切り)。共通イベント受信側の`CommonEventAuthenticator`と同じ形式 (契約v1.1 FINAL §9)
 * だが、あちらは受信検証用でこちらは送信署名用のため別実装として持つ。
 */
export function buildSenNoKuniCanonicalString(params: {
  keyId: string;
  timestamp: string;
  nonce: string;
  /** 呼び出し元がどちらの大文字小文字で渡しても内部で大文字化するため`string`で受ける。 */
  method: string;
  path: string;
  rawBody: string;
}): string {
  const pathWithoutQuery = params.path.split("?")[0]!;
  return [params.keyId, params.timestamp, params.nonce, params.method.toUpperCase(), pathWithoutQuery, params.rawBody].join(
    "\n",
  );
}

/**
 * 指示書7章。署名値は`sha256=<hex>`形式で送る。既存`hmacSign()`は生hexのみを返す
 * ため、他用途を破壊しないようここでprefixを付与する。
 */
export function signSenNoKuniRequest(secret: string, canonical: string): string {
  return `sha256=${hmacSign(secret, canonical)}`;
}

/**
 * 指示書6〜9章のHMAC Header一式を組み立てる。`rawBody`は実際に送信するバイト列と
 * 完全に同じ文字列を渡すこと (呼び出し元が`IntegrationHttpClient`へも同じ`rawBody`を
 * 渡す)。GETの署名対象bodyは指示書通り空文字とする。
 */
function buildSignedHeaders(params: {
  keyId: string;
  secret: string;
  method: "GET" | "POST";
  path: string;
  rawBody: string;
  correlationId: string;
  idempotencyKey?: string;
}): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomUUID();
  const canonical = buildSenNoKuniCanonicalString({
    keyId: params.keyId,
    timestamp,
    nonce,
    method: params.method,
    path: params.path,
    rawBody: params.rawBody,
  });
  const signature = signSenNoKuniRequest(params.secret, canonical);
  return {
    "X-SenNoKuni-Key-Id": params.keyId,
    "X-SenNoKuni-Timestamp": timestamp,
    "X-SenNoKuni-Nonce": nonce,
    "X-SenNoKuni-Signature": signature,
    "X-Correlation-Id": params.correlationId,
    ...(params.idempotencyKey ? { "Idempotency-Key": params.idempotencyKey } : {}),
  };
}

/**
 * NFTカードClaim導線実装指示書7章。戦国マーケットのClaim状態照会・確定を
 * サーバー間 (HMAC署名・timeout・レスポンスSchema検証) で呼び出す。
 * `IntegrationHttpClient`/Adapterパターン (Phase 7) に倣うが、代理店システムの
 * 単一APIキー認証とは異なりHMAC複数ヘッダーを使うため、`extraHeaders`経由で渡す。
 */
@Injectable()
export class SengokuMarketClaimAdapter {
  private readonly logger = new Logger(SengokuMarketClaimAdapter.name);

  constructor(private readonly http: IntegrationHttpClient) {}

  async getClaimStatus(rawToken: string, correlationId: string = randomUUID()): Promise<GetClaimStatusResult> {
    const config = resolveMarketClaimConfig();
    if (!config) return { outcome: "disabled" };

    const path = `/api/collectible-claims/${encodeURIComponent(rawToken)}`;
    const headers = buildSignedHeaders({
      keyId: config.keyId,
      secret: config.hmacSecret,
      method: "GET",
      path,
      rawBody: "",
      correlationId,
    });

    const result = await this.http.request({
      baseUrl: config.baseUrl,
      path,
      method: "GET",
      extraHeaders: headers,
      correlationId,
      timeoutMs: 5000,
      responseSchema: MarketClaimStatusResponseSchema,
      logger: this.logger,
    });

    if (result.ok) {
      return {
        outcome: "ok",
        status: result.data.status,
        cardName: result.data.card_name ?? null,
        expiresAt: result.data.expires_at ?? null,
      };
    }
    return this.classifyStatusError(result.error);
  }

  async confirmClaim(params: {
    rawToken: string;
    commonUserId: string;
    idempotencyKey: string;
    correlationId?: string;
  }): Promise<ConfirmClaimResult> {
    const config = resolveMarketClaimConfig();
    if (!config) return { outcome: "disabled" };

    const correlationId = params.correlationId ?? randomUUID();
    const path = `/api/collectible-claims/${encodeURIComponent(params.rawToken)}/confirm`;
    const body = { common_user_id: params.commonUserId };
    // 署名対象とHTTP送信は必ずこの同じ文字列を使う (指示書8章、二重JSON.stringify禁止)。
    const rawBody = JSON.stringify(body);
    const headers = buildSignedHeaders({
      keyId: config.keyId,
      secret: config.hmacSecret,
      method: "POST",
      path,
      rawBody,
      correlationId,
      idempotencyKey: params.idempotencyKey,
    });

    const result = await this.http.request({
      baseUrl: config.baseUrl,
      path,
      method: "POST",
      rawBody,
      extraHeaders: headers,
      correlationId,
      timeoutMs: 5000,
      responseSchema: MarketClaimConfirmResponseSchema,
      logger: this.logger,
    });

    if (result.ok) {
      return { outcome: "accepted", status: result.data.status ?? "DELIVERY_PENDING" };
    }
    return this.classifyConfirmError(result.error);
  }

  private classifyStatusError(error: IntegrationErrorResult): GetClaimStatusResult {
    if (error.kind === "timeout") return { outcome: "timeout" };
    if (error.kind === "network" || error.kind === "http_5xx") return { outcome: "network_error" };
    if (error.kind === "invalid_response") return { outcome: "invalid_response" };
    if (error.status === 404) return { outcome: "not_found" };
    if (error.status === 410) return { outcome: "expired" };
    return { outcome: "network_error" };
  }

  private classifyConfirmError(error: IntegrationErrorResult): ConfirmClaimResult {
    if (error.kind === "timeout") return { outcome: "timeout" };
    if (error.kind === "network" || error.kind === "http_5xx") return { outcome: "network_error" };
    if (error.kind === "invalid_response") return { outcome: "invalid_response" };
    if (error.status === 404) return { outcome: "not_found" };
    if (error.status === 410) return { outcome: "expired" };
    if (error.status === 409) {
      const parsed = MarketClaimErrorBodySchema.safeParse(error.body);
      const code = parsed.success ? parsed.data.code : undefined;
      if (code === "revoked") return { outcome: "revoked" };
      if (code === "common_user_mismatch") return { outcome: "common_user_mismatch" };
      return { outcome: "processing" };
    }
    return { outcome: "network_error" };
  }
}
