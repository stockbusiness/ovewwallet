import { hmacVerify } from "./crypto";
import type { KeyValueStore } from "./kv-store";

const MAX_TIMESTAMP_SKEW_MS = 5 * 60 * 1000; // 契約8章: 許容時間差は原則5分以内

export class CommonEventAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommonEventAuthError";
  }
}

export interface CommonEventRequestContext {
  keyId: string;
  /** X-SenNoKuni-Timestamp (unix timestamp、秒単位)。既存のExternalApiAuthenticatorの
   * epochミリ秒とは単位が異なる点に注意。 */
  timestamp: string;
  nonce: string;
  signature: string;
  /** 生のリクエストボディ文字列。署名対象に含まれる (契約6.1章)。 */
  rawBody: string;
  /** HTTPメソッド (署名対象に含める、次期改修指示書P0-2)。 */
  method: string;
  /** リクエストパス (署名対象に含める、次期改修指示書P0-2)。 */
  path: string;
  sourceSystemKey: string;
}

export interface CommonEventSigningCredentials {
  keyId: string;
  secret: string;
}

/**
 * 千ノ国 全体統合 共通実装契約 6.1章の`X-SenNoKuni-*`ヘッダー検証。
 *
 * 署名対象文字列は`timestamp + "." + nonce + "." + key_id + "." + method + ":" + path
 * + ":" + raw_body`。契約書原文は`timestamp + "." + raw_body`のみだったが、この形式では
 * `X-SenNoKuni-Nonce`が署名対象に含まれず、同じ署名のままnonceだけ差し替えたリクエストを
 * リプレイできてしまう脆弱性があった (次期改修指示書P0-2)。この共通イベント受信機能は
 * まだどの外部システムとも本番接続していない未公開機能のため、後方互換より安全性を
 * 優先しここで署名フォーマットを確定する。送信側システムの実装もこのフォーマットに
 * 合わせて同時に更新する必要がある。
 */
export class CommonEventAuthenticator {
  constructor(private readonly nonceStore: KeyValueStore) {}

  async verify(ctx: CommonEventRequestContext, credentials: CommonEventSigningCredentials): Promise<void> {
    if (ctx.keyId !== credentials.keyId) {
      throw new CommonEventAuthError("key_id does not match the resolved signing key");
    }

    const requestTimeMs = Number(ctx.timestamp) * 1000;
    if (!Number.isFinite(requestTimeMs) || Math.abs(Date.now() - requestTimeMs) > MAX_TIMESTAMP_SKEW_MS) {
      throw new CommonEventAuthError("request timestamp is outside the allowed skew");
    }

    const signaturePayload = `${ctx.timestamp}.${ctx.nonce}.${ctx.keyId}.${ctx.method}:${ctx.path}:${ctx.rawBody}`;
    if (!hmacVerify(credentials.secret, signaturePayload, ctx.signature)) {
      throw new CommonEventAuthError("invalid HMAC signature");
    }

    const nonceKey = `common-event:nonce:${ctx.keyId}:${ctx.nonce}`;
    const seenCount = await this.nonceStore.incr(nonceKey, Math.ceil(MAX_TIMESTAMP_SKEW_MS / 1000));
    if (seenCount > 1) {
      throw new CommonEventAuthError("nonce has already been used (replay detected)");
    }
  }
}
