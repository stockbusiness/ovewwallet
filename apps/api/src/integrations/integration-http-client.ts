import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { ZodSchema } from "zod";

export type IntegrationErrorKind = "timeout" | "network" | "http_4xx" | "http_5xx" | "invalid_response";

export interface IntegrationErrorResult {
  readonly kind: IntegrationErrorKind;
  readonly retryable: boolean;
  readonly status?: number;
  readonly message: string;
  /**
   * 4xx/5xxレスポンスのJSON本文 (best-effort、パース不可なら未設定)。Claim Client等、
   * 同じHTTPステータスでも本文の`code`/`reason`でエラー種別をさらに細分化する
   * 呼び出し元向け (例: 409でも revoked / common_user_mismatch / processing を区別する)。
   */
  readonly body?: unknown;
}

export type IntegrationResult<T> = { ok: true; data: T } | { ok: false; error: IntegrationErrorResult };

export interface IntegrationRequestParams<T = void> {
  baseUrl: string;
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  /** 省略時は`apiKeyHeader`を付与しない (HMAC等、単一APIキーヘッダー以外の認証方式を使う呼び出し元向け)。 */
  apiKey?: string;
  apiKeyHeader?: string;
  /** APIキー以外に付与したい追加ヘッダー (例: HMAC署名関連のX-SenNoKuni-*ヘッダー)。 */
  extraHeaders?: Record<string, string>;
  correlationId?: string;
  timeoutMs?: number;
  /** 省略時はレスポンスボディを読まず、`res.ok`のみで成否判定する(既存クライアントの一部の挙動に合わせる)。 */
  responseSchema?: ZodSchema<T>;
  logger?: Logger;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_API_KEY_HEADER = "x-api-key";

function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 4) return "****";
  return `****${apiKey.slice(-4)}`;
}

function classifyRetryable(kind: IntegrationErrorKind): boolean {
  return kind === "timeout" || kind === "network" || kind === "http_5xx";
}

/**
 * リファクタリング指示書 Phase 7「外部HTTP基盤」。外部システム(現状は代理店システム
 * sengoku-ai.com)へのHTTP呼び出しで共通に必要な処理(timeout/AbortController、
 * JSON送受信、Zodレスポンス検証、request_id/correlation_id付与、APIキー認証ヘッダー、
 * エラー分類、リトライ対象判定、ログ上のAPIキーマスキング)を一箇所に集約する。
 *
 * 呼び出し元(各Adapter)は結果を`IntegrationResult<T>`として受け取り、成否の解釈
 * (例外を投げるか、null/falseを返すベストエフォートにするか)は呼び出し元の
 * ポリシーに委ねる — 本クラス自体は例外を投げない。
 */
@Injectable()
export class IntegrationHttpClient {
  private readonly logger = new Logger(IntegrationHttpClient.name);

  async request<T = void>(params: IntegrationRequestParams<T>): Promise<IntegrationResult<T>> {
    const method = params.method ?? "POST";
    const timeoutMs = params.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const requestId = randomUUID();
    const correlationId = params.correlationId ?? requestId;
    const apiKeyHeader = params.apiKeyHeader ?? DEFAULT_API_KEY_HEADER;
    const url = `${params.baseUrl}${params.path}`;
    const logger = params.logger ?? this.logger;

    const logContext = {
      url,
      method,
      requestId,
      correlationId,
      apiKey: params.apiKey ? maskApiKey(params.apiKey) : undefined,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          "content-type": "application/json",
          ...(params.apiKey ? { [apiKeyHeader]: params.apiKey } : {}),
          ...params.extraHeaders,
          "x-request-id": requestId,
          "x-correlation-id": correlationId,
        },
        body: params.body !== undefined ? JSON.stringify(params.body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const kind: IntegrationErrorKind = res.status >= 500 ? "http_5xx" : "http_4xx";
        logger.warn(`integration request failed: status=${res.status} ${JSON.stringify(logContext)}`);
        const bodyText = await res.text().catch(() => undefined);
        let parsedBody: unknown;
        try {
          parsedBody = bodyText ? JSON.parse(bodyText) : undefined;
        } catch {
          parsedBody = undefined;
        }
        return {
          ok: false,
          error: {
            kind,
            retryable: classifyRetryable(kind),
            status: res.status,
            message: `HTTP ${res.status}`,
            body: parsedBody,
          },
        };
      }

      if (!params.responseSchema) {
        return { ok: true, data: undefined as T };
      }

      const json: unknown = await res.json();
      const parsed = params.responseSchema.safeParse(json);
      if (!parsed.success) {
        logger.warn(`integration response failed schema validation: ${JSON.stringify(logContext)}`);
        return {
          ok: false,
          error: { kind: "invalid_response", retryable: false, message: parsed.error.message },
        };
      }

      return { ok: true, data: parsed.data };
    } catch (error) {
      const kind: IntegrationErrorKind = controller.signal.aborted ? "timeout" : "network";
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`integration request error: kind=${kind} ${JSON.stringify(logContext)} ${message}`);
      return { ok: false, error: { kind, retryable: classifyRetryable(kind), message } };
    } finally {
      clearTimeout(timer);
    }
  }
}
