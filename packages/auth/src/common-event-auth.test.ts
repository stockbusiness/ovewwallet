import { describe, expect, it } from "vitest";
import { InMemoryKeyValueStore } from "./kv-store";
import { CommonEventAuthenticator, CommonEventAuthError } from "./common-event-auth";
import { hmacSign } from "./crypto";

function buildContext(overrides: Partial<Parameters<CommonEventAuthenticator["verify"]>[0]> = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "nonce-1";
  const keyId = "key-1";
  const method = "POST";
  const path = "/api/integrations/events";
  const rawBody = JSON.stringify({ event_id: "evt_1", event_type: "reward.granted" });
  const secret = "test-common-event-secret";
  const signature = hmacSign(secret, `${timestamp}.${nonce}.${keyId}.${method}:${path}:${rawBody}`);

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
    const signature = hmacSign(secret, `${staleTimestamp}.${nonce}.key-1.${method}:${path}:${rawBody}`);

    await expect(
      auth.verify(
        { keyId: "key-1", timestamp: staleTimestamp, nonce, signature, rawBody, method, path, sourceSystemKey: "agency-system" },
        { keyId: "key-1", secret },
      ),
    ).rejects.toBeInstanceOf(CommonEventAuthError);
  });
});
