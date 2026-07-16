import "reflect-metadata";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { prisma, generateId } from "@ove/database";
import { hashSecret, encryptSecret, generateOpaqueToken } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

const KID = "test-kid-1";
const ISSUER = "https://sengoku-ai.com";
const AUDIENCE = "ove-wallet-test";
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-only-insecure-encryption-key";

/** SENGOKU_AI_JWKS_URLが指す先として使う、テスト用の最小JWKSサーバー。 */
async function startJwksServer(jwks: unknown): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(jwks));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/jwks`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

describe("戦国経済圏代理店システム外部連携 (仕様書v3.6.71 / 開発ガイドラインv1.0)", () => {
  let app: INestApplication;
  let jwksServer: { url: string; close: () => Promise<void> };
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  let partnerApiKey: string;
  let serviceIntegrationId: string;

  beforeAll(async () => {
    const { privateKey: sk, publicKey } = await generateKeyPair("RS256");
    privateKey = sk;
    const jwk = await exportJWK(publicKey);
    jwksServer = await startJwksServer({ keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] });

    process.env.SENGOKU_AI_JWKS_URL = jwksServer.url;
    process.env.SENGOKU_AI_SSO_AUDIENCE = AUDIENCE;
    process.env.SENGOKU_AI_SSO_ISSUER = ISSUER;
    process.env.ENABLE_AGENCY_REFERRAL_SYNC = "true";

    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    partnerApiKey = `oveagn_test_${generateId()}`;
    const integration = await prisma.serviceIntegration.upsert({
      where: { serviceCode: "AGENCY_SYSTEM" },
      update: { apiKeyHash: hashSecret(partnerApiKey), status: "ACTIVE" },
      create: {
        id: generateId(),
        serviceCode: "AGENCY_SYSTEM",
        serviceName: "test",
        apiKeyHash: hashSecret(partnerApiKey),
        signingSecretEncrypted: encryptSecret(generateOpaqueToken(32), ENCRYPTION_KEY),
        allowedIps: [],
        dailyAmountLimit: 0,
        perRequestAmountLimit: 0,
      },
    });
    serviceIntegrationId = integration.id;
  });

  afterAll(async () => {
    await app.close();
    await jwksServer.close();
    await prisma.$disconnect();
  });

  async function signAgencyJwt(claims: Record<string, unknown>, expSeconds = 60): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: KID })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject((claims.external_id as string) ?? "unknown")
      .setIssuedAt(now)
      .setExpirationTime(now + expSeconds)
      .setJti(`jti-${generateOpaqueToken(8)}`)
      .sign(privateKey);
  }

  function findLink(externalUserId: string) {
    return prisma.accountLink.findUnique({
      where: { serviceIntegrationId_externalUserId: { serviceIntegrationId, externalUserId } },
    });
  }

  describe("POST /api/integrations/agencies (受信, 7章)", () => {
    it("rejects requests without an API key", async () => {
      await request(app.getHttpServer())
        .post("/api/integrations/agencies")
        .send({ external_id: "no-auth-test" })
        .expect(401);
    });

    it("rejects requests when ENABLE_AGENCY_REFERRAL_SYNC is disabled", async () => {
      process.env.ENABLE_AGENCY_REFERRAL_SYNC = "false";
      try {
        await request(app.getHttpServer())
          .post("/api/integrations/agencies")
          .set("x-api-key", partnerApiKey)
          .send({ event: "connection_test", dry_run: true, external_id: "__connection_test__" })
          .expect(503);
      } finally {
        process.env.ENABLE_AGENCY_REFERRAL_SYNC = "true";
      }
    });

    it("accepts x-api-key and does not persist connection_test/dry_run requests", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/integrations/agencies")
        .set("x-api-key", partnerApiKey)
        .send({ event: "connection_test", dry_run: true, source: "sengoku-ai", external_id: "__connection_test__" })
        .expect(201);

      expect(res.body).toEqual({ success: true, message: "connection ok" });
      const row = await findLink("__connection_test__");
      expect(row).toBeNull();
    });

    it("accepts Authorization: Bearer as an alternative to x-api-key", async () => {
      await request(app.getHttpServer())
        .post("/api/integrations/agencies")
        .set("Authorization", `Bearer ${partnerApiKey}`)
        .send({ event: "connection_test", dry_run: true, external_id: "__connection_test__" })
        .expect(201);
    });

    it("upserts a PENDING account_link by external_id, unmatched to any OVE account", async () => {
      const externalId = `dir_${generateId()}`;
      const res = await request(app.getHttpServer())
        .post("/api/integrations/agencies")
        .set("x-api-key", partnerApiKey)
        .send({
          event: "upsert",
          source: "sengoku-ai",
          external_id: externalId,
          parent_external_id: "agent_7_8573",
          name: "山田代理店",
          contact_email: "contact@example.com",
          role: "director",
          role_label: "ディレクター",
          status: "active",
        })
        .expect(201);

      expect(res.body).toEqual({ success: true, data: { external_id: externalId, synced: true } });

      const row = await findLink(externalId);
      expect(row).not.toBeNull();
      expect(row!.status).toBe("PENDING");
      expect(row!.oveAccountId).toBeNull();
      expect((row!.metadata as Record<string, unknown>).name).toBe("山田代理店");

      // 同じexternal_idで再送すると更新される(重複作成されない)
      await request(app.getHttpServer())
        .post("/api/integrations/agencies")
        .set("x-api-key", partnerApiKey)
        .send({ event: "updated", external_id: externalId, status: "suspended" })
        .expect(201);

      const updated = await findLink(externalId);
      expect((updated!.metadata as Record<string, unknown>).syncStatus).toBe("suspended");
      expect(
        await prisma.accountLink.count({ where: { serviceIntegrationId, externalUserId: externalId } }),
      ).toBe(1);
    });
  });

  describe("POST /api/v1/auth/sso/agency (SSOログイン, 12章)", () => {
    it("logs in and promotes the account_link to ACTIVE, linked to the created OVE account", async () => {
      const externalId = `dir_sso_${generateId()}`;
      const token = await signAgencyJwt({
        external_id: externalId,
        role_level: 2,
        role_label: "ディレクター",
        agency_name: "テスト代理店",
        contact_email: "sso-test@example.com",
      });

      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/sso/agency")
        .send({ token, termsAccepted: true })
        .expect(201);

      expect(res.body.ove_account_id).toBeTruthy();
      expect(res.headers["set-cookie"]).toBeDefined();

      const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: res.body.ove_account_id } });
      expect(account.displayName).toBe("テスト代理店");

      const link = await findLink(externalId);
      expect(link!.status).toBe("ACTIVE");
      expect(link!.oveAccountId).toBe(account.id);
      expect(link!.verifiedAt).not.toBeNull();
    });

    it("promotes an existing PENDING sync record to ACTIVE on first SSO login", async () => {
      const externalId = `dir_sync_then_sso_${generateId()}`;
      await request(app.getHttpServer())
        .post("/api/integrations/agencies")
        .set("x-api-key", partnerApiKey)
        .send({ event: "upsert", external_id: externalId, name: "同期先行代理店" })
        .expect(201);
      expect((await findLink(externalId))!.status).toBe("PENDING");

      const token = await signAgencyJwt({ external_id: externalId, agency_name: "同期先行代理店" });
      const res = await request(app.getHttpServer())
        .post("/api/v1/auth/sso/agency")
        .send({ token, termsAccepted: true })
        .expect(201);

      const link = await findLink(externalId);
      expect(link!.status).toBe("ACTIVE");
      expect(link!.oveAccountId).toBe(res.body.ove_account_id);
    });

    it("rejects a replayed token", async () => {
      const token = await signAgencyJwt({ external_id: `dir_replay_${generateId()}` });

      await request(app.getHttpServer())
        .post("/api/v1/auth/sso/agency")
        .send({ token, termsAccepted: true })
        .expect(201);

      await request(app.getHttpServer())
        .post("/api/v1/auth/sso/agency")
        .send({ token, termsAccepted: true })
        .expect(401);
    });

    it("rejects a token signed with the wrong audience", async () => {
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({ external_id: `dir_badaud_${generateId()}` })
        .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: KID })
        .setIssuer(ISSUER)
        .setAudience("someone-else")
        .setSubject("x")
        .setIssuedAt(now)
        .setExpirationTime(now + 60)
        .setJti(`jti-${generateOpaqueToken(8)}`)
        .sign(privateKey);

      await request(app.getHttpServer()).post("/api/v1/auth/sso/agency").send({ token, termsAccepted: true }).expect(401);
    });

    it("rejects an expired token", async () => {
      const token = await signAgencyJwt({ external_id: `dir_expired_${generateId()}` }, -120);

      await request(app.getHttpServer()).post("/api/v1/auth/sso/agency").send({ token, termsAccepted: true }).expect(401);
    });
  });
});
