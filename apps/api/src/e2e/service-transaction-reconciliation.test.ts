import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { generateId, prisma } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { createTestServiceIntegration, signedHeaders, type TestServiceIntegration } from "./test-helpers";

/**
 * 千ノ国パスポート等との日次照合用API (/api/v1/service/transactions/*)。
 * 認証済みserviceIntegrationが自ら付与・利用した取引のみを対象にし、他サービスの
 * 取引を横断的に照会できないことを検証する (残高照会APIと同じ横断禁止方針)。
 */
describe("外部サービス向け取引照会 (/api/v1/service/transactions)", () => {
  let app: INestApplication;
  let serviceA: TestServiceIntegration;
  let serviceB: TestServiceIntegration;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    serviceA = await createTestServiceIntegration("SENGOKU_PASSPORT");
    serviceB = await createTestServiceIntegration("AIART");
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function grantViaServiceA(overrides: Partial<Record<string, unknown>> = {}) {
    const server = app.getHttpServer();
    const externalUserId = `svc-recon-${generateId()}`;
    const idempotencyKey = `IDEM-${generateId()}`;
    const grantBody = {
      service_code: "SENGOKU_PASSPORT",
      external_user_id: externalUserId,
      event_type: "LEARNING_MISSION_COMPLETED",
      event_id: `MISSION-${generateId()}`,
      amount: 100,
      transaction_type: "LEARNING_JOURNEY_REWARD",
      display_name: "はじまりの旅 特典",
      idempotency_key: idempotencyKey,
      ...overrides,
    };
    const res = await request(server)
      .post("/api/v1/rewards/grant")
      .set(signedHeaders(serviceA, "POST", "/api/v1/rewards/grant", grantBody))
      .send(grantBody)
      .expect(201);
    return { externalUserId, idempotencyKey, transactionId: res.body.id as string };
  }

  describe("GET /by-idempotency-key/:idempotencyKey", () => {
    it("自サービスの取引をidempotency_keyで照会できる", async () => {
      const { externalUserId, idempotencyKey } = await grantViaServiceA();
      const path = `/api/v1/service/transactions/by-idempotency-key/${idempotencyKey}`;

      const res = await request(app.getHttpServer())
        .get(path)
        .set(signedHeaders(serviceA, "GET", path, {}))
        .expect(200);

      expect(res.body.idempotency_key).toBe(idempotencyKey);
      expect(res.body.external_user_id).toBe(externalUserId);
      expect(res.body.transaction_type).toBe("LEARNING_JOURNEY_REWARD");
      expect(res.body.rule_code).toBe("SENGOKU_LEARNING_JOURNEY_REWARD");
      expect(res.body.amount).toBe("100");
      expect(res.body.status).toBe("COMPLETED");
    });

    it("他サービスの取引は404になる (存在するidempotency_keyでも横断照会できない)", async () => {
      const { idempotencyKey } = await grantViaServiceA();
      const path = `/api/v1/service/transactions/by-idempotency-key/${idempotencyKey}`;

      await request(app.getHttpServer())
        .get(path)
        .set(signedHeaders(serviceB, "GET", path, {}))
        .expect(404);
    });

    it("存在しないidempotency_keyも404になる (存在有無を区別しない)", async () => {
      const path = `/api/v1/service/transactions/by-idempotency-key/does-not-exist-${generateId()}`;

      await request(app.getHttpServer())
        .get(path)
        .set(signedHeaders(serviceA, "GET", path, {}))
        .expect(404);
    });

    it("HMAC署名がなければ401になる", async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/service/transactions/by-idempotency-key/anything`)
        .expect(401);
    });
  });

  describe("GET /export", () => {
    it("自サービスの取引だけをperiodとrule_codeで絞り込んでCSVに含める", async () => {
      const { externalUserId, idempotencyKey } = await grantViaServiceA();

      const periodFrom = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const periodTo = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const path = `/api/v1/service/transactions/export?period_from=${encodeURIComponent(periodFrom)}&period_to=${encodeURIComponent(periodTo)}&rule_code=SENGOKU_LEARNING_JOURNEY_REWARD`;

      const res = await request(app.getHttpServer())
        .get(path)
        .set(signedHeaders(serviceA, "GET", path, {}))
        .expect(200);

      expect(res.headers["content-type"]).toContain("text/csv");
      expect(res.text).toContain("transaction_id,idempotency_key,external_user_id,amount,transaction_type,rule_code,occurred_at,status");
      expect(res.text).toContain(idempotencyKey);
      expect(res.text).toContain(externalUserId);
      expect(res.text).toContain("SENGOKU_LEARNING_JOURNEY_REWARD");
    });

    it("他サービスの取引はCSVに含まれない", async () => {
      const { idempotencyKey: idemA } = await grantViaServiceA();

      const externalUserIdB = `svc-recon-b-${generateId()}`;
      const grantBodyB = {
        service_code: "AIART",
        external_user_id: externalUserIdB,
        event_type: "ATTENDANCE",
        event_id: `EVT-${generateId()}`,
        amount: 500,
        transaction_type: "AIART_ATTENDANCE",
        display_name: "AIアート教室参加特典",
        idempotency_key: `IDEM-B-${generateId()}`,
      };
      const grantResB = await request(app.getHttpServer())
        .post("/api/v1/rewards/grant")
        .set(signedHeaders(serviceB, "POST", "/api/v1/rewards/grant", grantBodyB))
        .send(grantBodyB)
        .expect(201);
      expect(grantResB.body.transaction_type).toBe("AIART_ATTENDANCE");

      const periodFrom = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const periodTo = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const path = `/api/v1/service/transactions/export?period_from=${encodeURIComponent(periodFrom)}&period_to=${encodeURIComponent(periodTo)}`;

      const res = await request(app.getHttpServer())
        .get(path)
        .set(signedHeaders(serviceA, "GET", path, {}))
        .expect(200);

      expect(res.text).toContain(idemA);
      expect(res.text).not.toContain(grantBodyB.idempotency_key);
    });

    it("未知のrule_codeは400になる", async () => {
      const periodFrom = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const periodTo = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const path = `/api/v1/service/transactions/export?period_from=${encodeURIComponent(periodFrom)}&period_to=${encodeURIComponent(periodTo)}&rule_code=NOT_A_REAL_RULE_CODE`;

      await request(app.getHttpServer())
        .get(path)
        .set(signedHeaders(serviceA, "GET", path, {}))
        .expect(400);
    });

    it("period_from/period_toが無いと400になる", async () => {
      const path = `/api/v1/service/transactions/export`;

      await request(app.getHttpServer())
        .get(path)
        .set(signedHeaders(serviceA, "GET", path, {}))
        .expect(400);
    });
  });
});
