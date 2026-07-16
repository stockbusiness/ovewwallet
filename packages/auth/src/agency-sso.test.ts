import { describe, expect, it } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JSONWebKeySet } from "jose";
import { InMemoryKeyValueStore } from "./kv-store";
import { AgencySsoVerifier, AgencySsoVerificationError } from "./agency-sso";

const ISSUER = "https://sengoku-ai.com";
const AUDIENCE = "ove-wallet";
const KID = "sso-20260709120000-abcd1234";

async function setupKeys() {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  const jwks: JSONWebKeySet = { keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] };
  return { privateKey, jwks };
}

async function signToken(
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"],
  overrides: Record<string, unknown> = {},
  expSeconds = 60,
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    external_id: "dir260b6d6e",
    role_level: 2,
    role_label: "ディレクター",
    agency_name: "山田代理店",
    contact_name: "山田 太郎",
    contact_email: "contact@example.com",
    client_key: AUDIENCE,
    client_name: "OVE Wallet",
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: KID })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject((overrides.external_id as string) ?? "dir260b6d6e")
    .setIssuedAt(now)
    .setExpirationTime(now + expSeconds)
    .setJti(`jti-${Math.random().toString(36).slice(2)}`)
    .sign(privateKey);
}

describe("AgencySsoVerifier", () => {
  it("verifies a valid token and extracts claims", async () => {
    const { privateKey, jwks } = await setupKeys();
    const verifier = new AgencySsoVerifier(new InMemoryKeyValueStore(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      jwks: createLocalJWKSet(jwks),
    });
    const token = await signToken(privateKey);

    const claims = await verifier.verify(token);
    expect(claims.externalId).toBe("dir260b6d6e");
    expect(claims.roleLevel).toBe(2);
    expect(claims.agencyName).toBe("山田代理店");
  });

  it("rejects a replayed jti (same token used twice)", async () => {
    const { privateKey, jwks } = await setupKeys();
    const verifier = new AgencySsoVerifier(new InMemoryKeyValueStore(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      jwks: createLocalJWKSet(jwks),
    });
    const token = await signToken(privateKey);

    await expect(verifier.verify(token)).resolves.toBeDefined();
    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AgencySsoVerificationError);
  });

  it("rejects an expired token", async () => {
    const { privateKey, jwks } = await setupKeys();
    const verifier = new AgencySsoVerifier(new InMemoryKeyValueStore(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      jwks: createLocalJWKSet(jwks),
    });
    const token = await signToken(privateKey, {}, -120);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AgencySsoVerificationError);
  });

  it("rejects a token with the wrong audience", async () => {
    const { privateKey, jwks } = await setupKeys();
    const verifier = new AgencySsoVerifier(new InMemoryKeyValueStore(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      jwks: createLocalJWKSet(jwks),
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ external_id: "dir260b6d6e" })
      .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: KID })
      .setIssuer(ISSUER)
      .setAudience("someone-else")
      .setSubject("dir260b6d6e")
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .setJti("jti-wrong-aud")
      .sign(privateKey);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AgencySsoVerificationError);
  });

  it("rejects a token signed with an unknown key (kid mismatch)", async () => {
    const { jwks } = await setupKeys();
    const otherKeyPair = await generateKeyPair("RS256");
    const verifier = new AgencySsoVerifier(new InMemoryKeyValueStore(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      jwks: createLocalJWKSet(jwks),
    });
    const token = await signToken(otherKeyPair.privateKey);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AgencySsoVerificationError);
  });

  it("rejects a token missing external_id and sub", async () => {
    const { privateKey, jwks } = await setupKeys();
    const verifier = new AgencySsoVerifier(new InMemoryKeyValueStore(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      jwks: createLocalJWKSet(jwks),
    });
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: KID })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 60)
      .setJti("jti-no-sub")
      .sign(privateKey);

    await expect(verifier.verify(token)).rejects.toBeInstanceOf(AgencySsoVerificationError);
  });
});
