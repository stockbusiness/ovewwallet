import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { decryptSecret, hashSecret } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { createTestServiceIntegration } from "./test-helpers";

/**
 * 外部サービスのAPIキー・署名シークレットを管理画面から再発行できるようにしたもの
 * (`POST /api/v1/admin/service-integrations/:id/rotate-*`)。
 *
 * 従来は `pnpm --filter @ove/database issue-service-integration --rotate` を本番DBに
 * 対して実行する必要があった。運用でサーバーを触らずに済ませるのが目的なので、
 * **返ってきた鍵が実際に認証に使えること**と、**旧い鍵が無効になること**を確かめる。
 */
describe("外部サービスの鍵の再発行 (管理画面から)", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `e2e-rotate-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Rotate Admin",
      },
    });
    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    adminCookie = loginRes.headers["set-cookie"] as unknown as string[];
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("再発行したAPIキーで認証でき、旧いキーは無効になる", async () => {
    const server = app.getHttpServer();
    // 代理店システムは x-api-key の単純照合のみ (AgencyApiKeyGuard) なので、
    // 鍵が効いているかを最も素直に確認できる。
    const integration = await createTestServiceIntegration("AGENCY_SYSTEM");
    const oldApiKey = integration.apiKey;

    const connectionTest = { event: "connection_test" };
    const previousFlag = process.env.ENABLE_AGENCY_REFERRAL_SYNC;
    process.env.ENABLE_AGENCY_REFERRAL_SYNC = "true";
    try {
      // 再発行前: 旧キーで通る
      await request(server)
        .post("/api/integrations/agencies")
        .set("x-api-key", oldApiKey)
        .send(connectionTest)
        .expect(201);

      const rotated = await request(server)
        .post(`/api/v1/admin/service-integrations/${integration.id}/rotate-api-key`)
        .set("Cookie", adminCookie)
        .send({ reason: "e2e: 鍵の再発行" })
        .expect(201);

      const newApiKey: string = rotated.body.apiKey;
      expect(typeof newApiKey).toBe("string");
      expect(newApiKey).not.toBe(oldApiKey);
      expect(rotated.body.serviceCode).toBe("AGENCY_SYSTEM");

      // 再発行後: 新しいキーで通り、旧キーは拒否される
      await request(server)
        .post("/api/integrations/agencies")
        .set("x-api-key", newApiKey)
        .send(connectionTest)
        .expect(201);
      await request(server)
        .post("/api/integrations/agencies")
        .set("x-api-key", oldApiKey)
        .send(connectionTest)
        .expect(401);
    } finally {
      if (previousFlag === undefined) delete process.env.ENABLE_AGENCY_REFERRAL_SYNC;
      else process.env.ENABLE_AGENCY_REFERRAL_SYNC = previousFlag;
    }
  });

  it("APIキーの生値は監査ログに残さない (閲覧権限が実行権限にならないようにする)", async () => {
    const integration = await createTestServiceIntegration("NFT_MARKET");

    const rotated = await request(app.getHttpServer())
      .post(`/api/v1/admin/service-integrations/${integration.id}/rotate-api-key`)
      .set("Cookie", adminCookie)
      .send({ reason: "e2e: 監査ログ確認" })
      .expect(201);

    const log = await prisma.auditLog.findFirst({
      where: { actionType: "SERVICE_INTEGRATION_API_KEY_ROTATE", targetId: integration.id },
      orderBy: { createdAt: "desc" },
    });

    expect(log).not.toBeNull();
    expect(log?.reason).toBe("e2e: 監査ログ確認");
    expect(JSON.stringify(log)).not.toContain(rotated.body.apiKey);
  });

  it("再発行した署名シークレットが保存され、復号して取り出せる", async () => {
    const integration = await createTestServiceIntegration("SENGOKU_EC");

    const rotated = await request(app.getHttpServer())
      .post(`/api/v1/admin/service-integrations/${integration.id}/rotate-signing-secret`)
      .set("Cookie", adminCookie)
      .send({ reason: "e2e: 署名鍵の再発行" })
      .expect(201);

    const stored = await prisma.serviceIntegration.findUniqueOrThrow({ where: { id: integration.id } });
    const encryptionKey = process.env.ENCRYPTION_KEY ?? "dev-only-insecure-encryption-key";
    // 暗号化して保存されており (生値ではない)、復号すると応答と一致する
    expect(stored.signingSecretEncrypted).not.toBe(rotated.body.signingSecret);
    expect(decryptSecret(stored.signingSecretEncrypted, encryptionKey)).toBe(rotated.body.signingSecret);
  });

  it("存在しないIDは404、理由が空なら400", async () => {
    const integration = await createTestServiceIntegration("EVENT_SYSTEM");

    await request(app.getHttpServer())
      .post(`/api/v1/admin/service-integrations/${generateId()}/rotate-api-key`)
      .set("Cookie", adminCookie)
      .send({ reason: "e2e" })
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/service-integrations/${integration.id}/rotate-api-key`)
      .set("Cookie", adminCookie)
      .send({ reason: "" })
      .expect(400);
  });

  it("未ログインでは再発行できない", async () => {
    const integration = await createTestServiceIntegration("SENGOKU_METAVERSE");
    await request(app.getHttpServer())
      .post(`/api/v1/admin/service-integrations/${integration.id}/rotate-api-key`)
      .send({ reason: "e2e" })
      .expect(401);
  });
});
