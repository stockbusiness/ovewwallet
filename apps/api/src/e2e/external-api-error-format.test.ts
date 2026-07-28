import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { hashSecret, encryptSecret } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { createTestServiceIntegration, signedHeaders, type TestServiceIntegration } from "./test-helpers";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-only-insecure-encryption-key";

/**
 * 外部開発者向け連携ガイド v3.6.78-draft 13章のエラー形式
 * `{ok:false, error:{code,message}}` が、外部システムが直接叩くAPI
 * (代理店同期Webhook・報酬付与・取引デビット/取消) にのみ適用され、
 * ウォレット自身のフロントエンドが使うセッション認証APIには影響しないことを確認する。
 */
describe("外部連携APIのエラー形式 (ExternalApiExceptionFilter)", () => {
  let app: INestApplication;
  let agencyApiKey: string;
  let rewardsIntegration: TestServiceIntegration;

  beforeAll(async () => {
    process.env.ENABLE_AGENCY_REFERRAL_SYNC = "true";

    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    agencyApiKey = `oveagn_test_${generateId()}`;
    await prisma.serviceIntegration.upsert({
      where: { serviceCode: "AGENCY_SYSTEM" },
      update: { apiKeyHash: hashSecret(agencyApiKey), status: "ACTIVE" },
      create: {
        id: generateId(),
        serviceCode: "AGENCY_SYSTEM",
        serviceName: "test",
        apiKeyHash: hashSecret(agencyApiKey),
        signingSecretEncrypted: encryptSecret(`secret_${generateId()}`, ENCRYPTION_KEY),
        allowedIps: [],
        dailyAmountLimit: 0,
        perRequestAmountLimit: 0,
      },
    });

    rewardsIntegration = await createTestServiceIntegration("AIART", { perRequestAmountLimit: 1_000_000 });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe("POST /api/integrations/agencies", () => {
    it("returns {ok:false, error:{code:API_KEY_REQUIRED}} when no API key is sent", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/integrations/agencies")
        .send({ external_id: "x" })
        .expect(401);

      expect(res.body).toEqual({
        ok: false,
        error: { code: "API_KEY_REQUIRED", message: expect.stringContaining("missing") },
        request_id: expect.any(String),
      });
    });

    it("returns {ok:false, error:{code:INVALID_API_KEY}} for a wrong API key", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/integrations/agencies")
        .set("x-api-key", "wrong-key")
        .send({ external_id: "x" })
        .expect(401);

      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe("INVALID_API_KEY");
    });

    it("returns {ok:false, error:{code:VALIDATION_ERROR}} when external_id is missing for an agency-record event", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/integrations/agencies")
        .set("x-api-key", agencyApiKey)
        .send({ event: "admin_updated" })
        .expect(400);

      expect(res.body).toEqual({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: expect.stringContaining("external_id") },
        request_id: expect.any(String),
      });
    });
  });

  describe("POST /api/v1/rewards/grant", () => {
    it("returns {ok:false, error:{code:API_KEY_REQUIRED}} without X-OVE-* headers", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/rewards/grant")
        .send({ service_code: "AIART", external_user_id: "u1" })
        .expect(401);

      expect(res.body).toEqual({
        ok: false,
        error: { code: "API_KEY_REQUIRED", message: expect.any(String) },
        request_id: expect.any(String),
      });
    });

    it("returns {ok:false, error:{code:VALIDATION_ERROR}} for a schema-invalid body", async () => {
      const body = { service_code: "AIART" }; // amount/event_id/idempotency_key等が欠落
      const headers = signedHeaders(rewardsIntegration, "POST", "/api/v1/rewards/grant", body);

      const res = await request(app.getHttpServer())
        .post("/api/v1/rewards/grant")
        .set(headers)
        .send(body)
        .expect(400);

      expect(res.body.ok).toBe(false);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("POST /api/v1/transactions/debit", () => {
    it("returns {ok:false, error:{code:InsufficientBalanceError}} when the debit exceeds the wallet's balance", async () => {
      const externalUserId = `debit-error-format-${generateId()}`;

      // まず少額を付与してウォレットを作成する (存在しないexternal_user_idへの
      // debitはWalletNotFoundError=404になるため、InsufficientBalanceError=409を
      // 再現するには先にウォレットを作っておく必要がある)。
      const grantBody = {
        service_code: "AIART",
        external_user_id: externalUserId,
        event_type: "attendance",
        event_id: `event-${generateId()}`,
        amount: 100,
        display_name: "test grant",
        idempotency_key: `grant-${generateId()}`,
      };
      await request(app.getHttpServer())
        .post("/api/v1/rewards/grant")
        .set(signedHeaders(rewardsIntegration, "POST", "/api/v1/rewards/grant", grantBody))
        .send(grantBody)
        .expect(201);

      const body = {
        service_code: "AIART",
        external_user_id: externalUserId,
        amount: 999999,
        display_name: "test debit",
        idempotency_key: `idem-${generateId()}`,
      };
      const headers = signedHeaders(rewardsIntegration, "POST", "/api/v1/transactions/debit", body);

      const res = await request(app.getHttpServer())
        .post("/api/v1/transactions/debit")
        .set(headers)
        .send(body)
        .expect(409);

      expect(res.body).toEqual({
        ok: false,
        error: { code: "InsufficientBalanceError", message: expect.any(String) },
        request_id: expect.any(String),
      });
    });
  });

  describe("セッション認証APIは影響を受けない (GET /api/v1/rewards/public)", () => {
    it("keeps the existing internal error format ({error, message, requestId}) when unauthenticated", async () => {
      const res = await request(app.getHttpServer()).get("/api/v1/rewards/public").expect(401);

      // 変更前と同じNestJS標準形状のまま (ok/error.codeのネストされた新形式にはならない)
      expect(res.body).toEqual({
        statusCode: 401,
        message: "not authenticated",
        error: "Unauthorized",
        requestId: expect.any(String),
      });
    });
  });
});
