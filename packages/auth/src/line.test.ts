import { describe, expect, it, vi } from "vitest";
import { LineIdTokenVerifier } from "./sso";

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("LineIdTokenVerifier (LINEの「IDトークン検証」APIを使った本番実装)", () => {
  it("throws at construction when channelId is empty (fail-closed misconfiguration)", () => {
    expect(() => new LineIdTokenVerifier({ channelId: "" })).toThrow(/channelId/);
  });

  it("returns the LINE user id and email on a successful verification", async () => {
    const fetchImpl = mockFetch(200, { sub: "U1234567890", email: "user@example.com", aud: "channel-123" });
    const verifier = new LineIdTokenVerifier({ channelId: "channel-123", fetchImpl });

    const claims = await verifier.verifyIdToken("real-line-id-token");
    expect(claims.lineUserId).toBe("U1234567890");
    expect(claims.email).toBe("user@example.com");

    // client_id (channelId) をLINE側の検証エンドポイントへ渡していることを確認する。
    const [, requestInit] = (fetchImpl as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(String(requestInit.body)).toContain("client_id=channel-123");
  });

  it("rejects when the endpoint responds with a non-2xx status", async () => {
    const fetchImpl = mockFetch(400, { error: "invalid_request" });
    const verifier = new LineIdTokenVerifier({ channelId: "channel-123", fetchImpl });

    await expect(verifier.verifyIdToken("bad-token")).rejects.toThrow(/status=400/);
  });

  it("rejects when the response is missing sub", async () => {
    const fetchImpl = mockFetch(200, { email: "user@example.com" });
    const verifier = new LineIdTokenVerifier({ channelId: "channel-123", fetchImpl });

    await expect(verifier.verifyIdToken("token-without-sub")).rejects.toThrow(/sub/);
  });

  it("rejects when aud does not match the configured channelId", async () => {
    const fetchImpl = mockFetch(200, { sub: "U1234567890", aud: "someone-elses-channel" });
    const verifier = new LineIdTokenVerifier({ channelId: "channel-123", fetchImpl });

    await expect(verifier.verifyIdToken("mismatched-aud-token")).rejects.toThrow(/aud mismatch/);
  });

  it("rejects an empty id token without calling the network", async () => {
    const fetchImpl = mockFetch(200, {});
    const verifier = new LineIdTokenVerifier({ channelId: "channel-123", fetchImpl });

    await expect(verifier.verifyIdToken("")).rejects.toThrow(/invalid LINE id token/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
