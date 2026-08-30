import { describe, expect, it } from "vitest";
import { buildTotpUri, computeTotpCode, findMatchingTotpCounter, generateTotpSecret, verifyTotpCode } from "./totp";

// RFC 6238 Appendix B の公式テストベクタ (ASCII秘密鍵 "12345678901234567890", SHA1)。
// RFCの例は8桁だが、動的切り詰め後の mod 10^8 値の下6桁は mod 10^6 の値と一致するため、
// 6桁運用 (Google Authenticator等の標準) でも同じ値を検証に使える。
const RFC_SECRET_ASCII = "12345678901234567890";
const RFC_SECRET_BASE32 = base32FromAscii(RFC_SECRET_ASCII);

function base32FromAscii(ascii: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const buffer = Buffer.from(ascii, "ascii");
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

describe("TOTP (RFC 6238)", () => {
  it.each([
    [59_000, "287082"],
    [1_111_111_109_000, "081804"],
    [1_111_111_111_000, "050471"],
    [1_234_567_890_000, "005924"],
    [2_000_000_000_000, "279037"],
  ])("matches the RFC 6238 test vector at time %i", (timeMs, expectedCode) => {
    expect(computeTotpCode(RFC_SECRET_BASE32, timeMs)).toBe(expectedCode);
  });

  it("verifies a code generated for the current time", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = computeTotpCode(secret, now);
    expect(verifyTotpCode(secret, code, now)).toBe(true);
  });

  it("tolerates one step of clock drift in either direction", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const codeOneStepAgo = computeTotpCode(secret, now - 30_000);
    const codeOneStepAhead = computeTotpCode(secret, now + 30_000);
    expect(verifyTotpCode(secret, codeOneStepAgo, now)).toBe(true);
    expect(verifyTotpCode(secret, codeOneStepAhead, now)).toBe(true);
  });

  it("rejects a code beyond the drift window", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const codeFarInFuture = computeTotpCode(secret, now + 300_000);
    expect(verifyTotpCode(secret, codeFarInFuture, now)).toBe(false);
  });

  it("rejects an incorrect code and non-numeric input", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const correct = computeTotpCode(secret, now);
    const wrong = correct === "000000" ? "111111" : "000000";
    expect(verifyTotpCode(secret, wrong, now)).toBe(false);
    expect(verifyTotpCode(secret, "abcdef", now)).toBe(false);
  });

  it("rejects a code generated with a different secret", () => {
    const secretA = generateTotpSecret();
    const secretB = generateTotpSecret();
    const now = Date.now();
    const codeForA = computeTotpCode(secretA, now);
    expect(verifyTotpCode(secretB, codeForA, now)).toBe(false);
  });

  it("findMatchingTotpCounter returns the step number that matched, or null when no step matches", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const step = Math.floor(now / 1000 / 30);
    const code = computeTotpCode(secret, now);
    expect(findMatchingTotpCounter(secret, code, now)).toBe(step);

    const codeOneStepAhead = computeTotpCode(secret, now + 30_000);
    expect(findMatchingTotpCounter(secret, codeOneStepAhead, now)).toBe(step + 1);

    const codeFarInFuture = computeTotpCode(secret, now + 300_000);
    expect(findMatchingTotpCounter(secret, codeFarInFuture, now)).toBeNull();
  });

  it("builds a well-formed otpauth:// URI without leaking the secret into the label", () => {
    const uri = buildTotpUri({ secret: "JBSWY3DPEHPK3PXP", accountName: "admin@example.com", issuer: "OVE Wallet" });
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("issuer=OVE");
    expect(decodeURIComponent(uri.split("/totp/")[1]!.split("?")[0]!)).toBe("OVE Wallet:admin@example.com");
  });
});
