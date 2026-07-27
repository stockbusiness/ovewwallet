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
 * 千ノ国 全体統合 共通実装契約 v1.1 FINAL §8〜9の`X-SenNoKuni-*`ヘッダー検証。
 *
 * 署名対象文字列 (canonical string) は契約書§9のとおり、LF区切りの6行:
 * `key_id + "\n" + timestamp + "\n" + nonce + "\n" + METHOD + "\n" + path (query除く) + "\n" + raw_body`。
 * `02_HMAC_SIGNATURE_TEST_VECTOR_V1.md`の固定テストベクトルで一致することを確認済み。
 *
 * 旧実装は`timestamp.nonce.key_id.method:path:raw_body`という独自形式で、契約書v1.1
 * FINALとは一致しなかった (千ノ国Step1共通仕様確認で判明)。この共通イベント受信機能は
 * まだどの外部システムとも本番接続していない未公開機能のため、後方互換より契約準拠を
 * 優先しここで訂正する。
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

    // 契約§9「pathはquery stringを含めない」。
    const pathWithoutQuery = ctx.path.split("?")[0]!;
    const signaturePayload = [
      ctx.keyId,
      ctx.timestamp,
      ctx.nonce,
      ctx.method.toUpperCase(),
      pathWithoutQuery,
      ctx.rawBody,
    ].join("\n");
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
