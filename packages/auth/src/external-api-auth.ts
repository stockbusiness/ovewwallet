import { hmacVerify } from "./crypto";
import type { KeyValueStore } from "./kv-store";

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000; // 5分

export class ExternalApiAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalApiAuthError";
  }
}

export interface ExternalApiRequestContext {
  apiKey: string;
  timestamp: string;
  nonce: string;
  signature: string;
  /** HTTPメソッド + パス + 生ボディ等を連結した署名対象文字列。 */
  canonicalPayload: string;
  sourceIp: string;
}

export interface ServiceIntegrationCredentials {
  serviceIntegrationId: string;
  signingSecret: string;
  allowedIps: string[];
}

/**
 * 外部サービスAPI認証 (指示書11章): APIキー・HMAC署名・タイムスタンプ・
 * nonce・IP制限を検証する。idempotency key と金額上限はサービス層で別途検証する。
 */
export class ExternalApiAuthenticator {
  constructor(private readonly nonceStore: KeyValueStore) {}

  async verify(
    ctx: ExternalApiRequestContext,
    credentials: ServiceIntegrationCredentials,
  ): Promise<void> {
    if (credentials.allowedIps.length > 0 && !credentials.allowedIps.includes(ctx.sourceIp)) {
      throw new ExternalApiAuthError("source IP is not allow-listed for this service");
    }

    const requestTime = Number(ctx.timestamp);
    if (!Number.isFinite(requestTime) || Math.abs(Date.now() - requestTime) > MAX_TIMESTAMP_SKEW_MS) {
      throw new ExternalApiAuthError("request timestamp is outside the allowed skew");
    }

    const signaturePayload = `${ctx.timestamp}.${ctx.nonce}.${ctx.canonicalPayload}`;
    if (!hmacVerify(credentials.signingSecret, signaturePayload, ctx.signature)) {
      throw new ExternalApiAuthError("invalid HMAC signature");
    }

    const nonceKey = `external-api:nonce:${credentials.serviceIntegrationId}:${ctx.nonce}`;
    const seenCount = await this.nonceStore.incr(nonceKey, Math.ceil(MAX_TIMESTAMP_SKEW_MS / 1000));
    if (seenCount > 1) {
      throw new ExternalApiAuthError("nonce has already been used (replay detected)");
    }
  }
}
