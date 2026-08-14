import { describe, expect, it } from "vitest";
import { InMemoryKeyValueStore } from "./kv-store";
import { CommonEventAuthenticator, CommonEventAuthError } from "./common-event-auth";
import { hmacSign } from "./crypto";

/** 契約v1.1 FINAL §9のcanonical string (LF区切り、pathはquery除く、methodは大文字)。 */
function canonicalString(keyId: string, timestamp: string, nonce: string, method: string, path: string, rawBody: string): string {
  return [keyId, timestamp, nonce, method.toUpperCase(), path.split("?")[0], rawBody].join("\n");
}

function buildContext(overrides: Partial<Parameters<CommonEventAuthenticator["verify"]>[0]> = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "nonce-1";
  const keyId = "key-1";
  const method = "POST";
  const path = "/api/integrations/events";
  const rawBody = JSON.stringify({ event_id: "evt_1", event_type: "reward.granted" });
  const secret = "test-common-event-secret";
  const signature = hmacSign(secret, canonicalString(keyId, timestamp, nonce, method, path, rawBody));

  return {
    ctx: {
      keyId,
      timestamp,
      nonce,
      signature,
      rawBody,
      method,
      path,
      sourceSystemKey: "agency-system",
      ...overrides,
    },
    secret,
  };
}

describe("CommonEventAuthenticator (共通実装契約6.1章、次期改修指示書P0-2)", () => {
  it("accepts a validly signed request", async () => {
    const auth = new CommonEventAuthenticator(new InMemoryKeyValueStore());
    const { ctx, secret } = buildContext();

    await expect(auth.verify(ctx, { keyId: "key-1", secret })).resolves.toBeUndefined();
  });

  it("accepts a signature with a sha256= prefix, as sent by the new 千ノ国NFTマーケット契約v2 (指示書20章)", async () => {
    const auth = new CommonEventAuthenticator(new InMemoryKeyValueStore());
    const { ctx, secret } = buildContext();

    await expect(
      auth.verify({ ...ctx, signature: `sha256=${ctx.signature}` }, { keyId: "key-1", secret }),
    ).resolves.toBeUndefined();
  });

  it("rejects a sha256=-prefixed signature whose hex part is wrong", async () => {
    const auth = new CommonEventAuthenticator(new InMemoryKeyValueStore());
    const { ctx, secret } = buildContext();

    await expect(
      auth.verify({ ...ctx, signature: `sha256=${"0".repeat(64)}` }, { keyId: "key-1", secret }),
    ).rejects.toBeInstanceOf(CommonEventAuthError);
  });

  it("rejects a replayed nonce", async () => {
    const auth = new CommonEventAuthenticator(new InMemoryKeyValueStore());
    const { ctx, secret } = buildContext();
    const credentials = { keyId: "key-1", secret };

    await auth.verify(ctx, credentials);
    await expect(auth.verify(ctx, credentials)).rejects.toBeInstanceOf(CommonEventAuthError);
  });

  it("rejects a request with the same signature but a different nonce (P0-2 replay-with-fresh-nonce)", async () => {
    const auth = new CommonEventAuthenticator(new InMemoryKeyValueStore());
    const { ctx, secret } = buildContext();

    // nonceだけ差し替え、署名はそのまま (旧脆弱性の再現)。nonceが署名対象に含まれる
    // ようになったため、signatureがnonceと矛盾し無効な署名として拒否されるはず。
    const tamperedCtx = { ...ctx, nonce: "nonce-2" };
    await expect(auth.verify(tamperedCtx, { keyId: "key-1", secret })).rejects.toBeInstanceOf(CommonEventAuthError);
  });

  it("rejects a tampered body (signature no longer matches)", async () => {
    const auth = new CommonEventAuthenticator(new InMemoryKeyValueStore());
    const { ctx, secret } = buildContext({ rawBody: JSON.stringify({ event_id: "evt_1", amount: 999999 }) });

    await expect(auth.verify(ctx, { keyId: "key-1", secret })).rejects.toBeInstanceOf(CommonEventAuthError);
  });

  it("rejects a mismatched key_id", async () => {
    const auth = new CommonEventAuthenticator(new InMemoryKeyValueStore());
    const { ctx, secret } = buildContext();

    await expect(auth.verify(ctx, { keyId: "other-key", secret })).rejects.toBeInstanceOf(CommonEventAuthError);
  });

  it("rejects stale timestamps (>5 minutes skew)", async () => {
    const auth = new CommonEventAuthenticator(new InMemoryKeyValueStore());
    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 10 * 60);
    const nonce = "nonce-stale";
    const method = "POST";
    const path = "/api/integrations/events";
    const rawBody = JSON.stringify({ event_id: "evt_stale" });
    const secret = "test-common-event-secret";
    const signature = hmacSign(secret, canonicalString("key-1", staleTimestamp, nonce, method, path, rawBody));

    await expect(
      auth.verify(
        { keyId: "key-1", timestamp: staleTimestamp, nonce, signature, rawBody, method, path, sourceSystemKey: "agency-system" },
        { keyId: "key-1", secret },
      ),
    ).rejects.toBeInstanceOf(CommonEventAuthError);
  });

  it("rejects a request whose path differs only by query string is still verified against the query-stripped path (契約§9 pathはquery stringを含めない)", async () => {
    const auth = new CommonEventAuthenticator(new InMemoryKeyValueStore());
    const { ctx, secret } = buildContext({ path: "/api/integrations/events?foo=bar" });

    // 送信側もquery抜きのpathで署名しているため、受信側がquery付きpathを受け取っても
    // 検証時にqueryを取り除けば一致するはず。
    await expect(auth.verify(ctx, { keyId: "key-1", secret })).resolves.toBeUndefined();
  });

  it("accepts a lowercase method by normalizing to uppercase before verifying (契約§9 methodは大文字)", async () => {
    const auth = new CommonEventAuthenticator(new InMemoryKeyValueStore());
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = "nonce-lowercase-method";
    const keyId = "key-1";
    const path = "/api/integrations/events";
    const rawBody = JSON.stringify({ event_id: "evt_lowercase" });
    const secret = "test-common-event-secret";
    // 署名計算はcanonicalString側で大文字化するため、POST/postどちらで送っても同じ結果になる。
    const signature = hmacSign(secret, canonicalString(keyId, timestamp, nonce, "post", path, rawBody));

    await expect(
      auth.verify(
        { keyId, timestamp, nonce, signature, rawBody, method: "post", path, sourceSystemKey: "agency-system" },
        { keyId, secret },
      ),
    ).resolves.toBeUndefined();
  });

  it("matches the fixed HMAC test vector from SEN_NO_KUNI_STEP1_COMMON_SPEC_PACKAGE_V1_1 (02_HMAC_SIGNATURE_TEST_VECTOR_V1.md)", async () => {
    const auth = new CommonEventAuthenticator(new InMemoryKeyValueStore());
    const keyId = "test-key-001";
    const secret = "sen-no-kuni-test-secret-v1";
    // 固定テストベクトルのtimestampは過去日時のため、そのままでは許容時間外(5分)で
    // 拒否されてしまう。署名アルゴリズム自体の一致を検証するのが目的のため、ここでは
    // 現在時刻のtimestampへ差し替えて再署名し、固定テストベクトルの期待署名は
    // 別途Node.jsで独立計算した値と突き合わせて確認する (このit内のコメント参照)。
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = "nonce-20260722-0001";
    const method = "POST";
    const path = "/api/integrations/events";
    const rawBody =
      '{"event_id":"evt_test_0001","event_type":"entitlement.granted","event_version":"1.0","occurred_at":"2026-07-22T01:00:00Z","source_system_key":"sengoku-market","common_user_id":"cu_test_0001","correlation_id":"corr_test_0001","data":{"entitlement_id":"ent_test_0001","entitlement_type":"passport_membership","quantity":1}}';
    const signature = hmacSign(secret, canonicalString(keyId, timestamp, nonce, method, path, rawBody));

    await expect(
      auth.verify(
        { keyId, timestamp, nonce, signature, rawBody, method, path, sourceSystemKey: "sengoku-market" },
        { keyId, secret },
      ),
    ).resolves.toBeUndefined();

    // 固定テストベクトルのtimestamp (1784691600) で計算した場合の署名が、配布パッケージの
    // 期待値と一致することも独立して確認する (timestamp skewチェックを迂回するため
    // authenticatorを経由せず直接計算する)。
    const fixedSignature = hmacSign(
      secret,
      canonicalString(keyId, "1784691600", nonce, method, path, rawBody),
    );
    expect(fixedSignature).toBe("e063066bc059f2c3c011cd29a4bf30cf3791e6a56920e9f5ddc5c358b87c229b");
  });
});
