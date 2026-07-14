import { describe, expect, it } from "vitest";
import { InMemoryKeyValueStore } from "./kv-store";
import { SengokuSsoService, SsoCodeInvalidError, MockLineAuthVerifier } from "./sso";

describe("SengokuSsoService", () => {
  it("exchanges a valid code exactly once", async () => {
    const service = new SengokuSsoService(new InMemoryKeyValueStore());
    const code = await service.issueCode("SENGOKU-MEMBER-1");

    // URLに個人情報を含めない: コードはランダム文字列のみで構成される
    expect(code).not.toMatch(/SENGOKU-MEMBER-1/);

    await expect(service.exchangeCode(code)).resolves.toEqual({
      sengokuMemberId: "SENGOKU-MEMBER-1",
    });
    await expect(service.exchangeCode(code)).rejects.toBeInstanceOf(SsoCodeInvalidError);
  });

  it("rejects a tampered code", async () => {
    const service = new SengokuSsoService(new InMemoryKeyValueStore());
    const code = await service.issueCode("SENGOKU-MEMBER-1");
    const [codeId] = code.split(".");
    const tampered = `${codeId}.not-the-real-secret`;

    await expect(service.exchangeCode(tampered)).rejects.toBeInstanceOf(SsoCodeInvalidError);
  });
});

describe("MockLineAuthVerifier", () => {
  it("extracts the LINE user id from a mock id token", async () => {
    const verifier = new MockLineAuthVerifier();
    await expect(verifier.verifyIdToken("mock.U1234567890")).resolves.toEqual({
      lineUserId: "U1234567890",
    });
  });

  it("rejects tokens that are not properly formed", async () => {
    const verifier = new MockLineAuthVerifier();
    await expect(verifier.verifyIdToken("not-a-real-token")).rejects.toThrow();
  });
});
