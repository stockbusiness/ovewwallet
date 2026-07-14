import { describe, expect, it } from "vitest";
import { InMemoryKeyValueStore } from "./kv-store";
import { ExternalApiAuthenticator, ExternalApiAuthError } from "./external-api-auth";
import { hmacSign } from "./crypto";

function buildContext(overrides: Partial<Parameters<ExternalApiAuthenticator["verify"]>[0]> = {}) {
  const timestamp = String(Date.now());
  const nonce = "nonce-1";
  const canonicalPayload = "POST:/api/v1/rewards/grant:{}";
  const secret = "test-signing-secret";
  const signature = hmacSign(secret, `${timestamp}.${nonce}.${canonicalPayload}`);

  return {
    ctx: {
      apiKey: "key-1",
      timestamp,
      nonce,
      signature,
      canonicalPayload,
      sourceIp: "127.0.0.1",
      ...overrides,
    },
    secret,
  };
}

describe("ExternalApiAuthenticator", () => {
  it("accepts a validly signed request", async () => {
    const auth = new ExternalApiAuthenticator(new InMemoryKeyValueStore());
    const { ctx, secret } = buildContext();

    await expect(
      auth.verify(ctx, {
        serviceIntegrationId: "svc-1",
        signingSecret: secret,
        allowedIps: [],
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a replayed nonce", async () => {
    const auth = new ExternalApiAuthenticator(new InMemoryKeyValueStore());
    const { ctx, secret } = buildContext();
    const credentials = { serviceIntegrationId: "svc-1", signingSecret: secret, allowedIps: [] };

    await auth.verify(ctx, credentials);
    await expect(auth.verify(ctx, credentials)).rejects.toBeInstanceOf(ExternalApiAuthError);
  });

  it("rejects a tampered signature", async () => {
    const auth = new ExternalApiAuthenticator(new InMemoryKeyValueStore());
    const { ctx, secret } = buildContext({ canonicalPayload: "POST:/api/v1/rewards/grant:{\"amount\":999999}" });

    await expect(
      auth.verify(ctx, { serviceIntegrationId: "svc-1", signingSecret: secret, allowedIps: [] }),
    ).rejects.toBeInstanceOf(ExternalApiAuthError);
  });

  it("rejects requests from a non-allow-listed IP", async () => {
    const auth = new ExternalApiAuthenticator(new InMemoryKeyValueStore());
    const { ctx, secret } = buildContext({ sourceIp: "10.0.0.1" });

    await expect(
      auth.verify(ctx, {
        serviceIntegrationId: "svc-1",
        signingSecret: secret,
        allowedIps: ["127.0.0.1"],
      }),
    ).rejects.toBeInstanceOf(ExternalApiAuthError);
  });

  it("rejects stale timestamps", async () => {
    const auth = new ExternalApiAuthenticator(new InMemoryKeyValueStore());
    const staleTimestamp = String(Date.now() - 10 * 60 * 1000);
    const nonce = "nonce-stale";
    const canonicalPayload = "POST:/api/v1/rewards/grant:{}";
    const secret = "test-signing-secret";
    const signature = hmacSign(secret, `${staleTimestamp}.${nonce}.${canonicalPayload}`);

    await expect(
      auth.verify(
        { apiKey: "key-1", timestamp: staleTimestamp, nonce, signature, canonicalPayload, sourceIp: "127.0.0.1" },
        { serviceIntegrationId: "svc-1", signingSecret: secret, allowedIps: [] },
      ),
    ).rejects.toBeInstanceOf(ExternalApiAuthError);
  });
});
