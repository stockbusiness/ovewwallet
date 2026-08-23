import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { generateId, prisma } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { TRANSACTION_SERVICE_SCOPES } from "../transactions/transaction-service-scopes";
import {
  createTestServiceIntegration,
  signedHeaders,
  type TestServiceIntegration,
} from "./test-helpers";

const SCOPES = [
  TRANSACTION_SERVICE_SCOPES.TRANSACTIONS_READ,
  TRANSACTION_SERVICE_SCOPES.TRANSACTIONS_EXPORT,
];

/**
 * 千ノ国パスポート等との日次照合用API (/api/v1/service/transactions/*)。
 * 認証済みserviceIntegrationが自ら付与・利用した取引のみを対象にし、他サービスの
 * 取引を横断的に照会できないことを検証する (残高照会APIと同じ横断禁止方針)。
 */
describe("外部サービス向け取引照会 (/api/v1/service/transactions)", () => {
  let app: INestApplication;
  let serviceA: TestServiceIntegration;
  let serviceB: TestServiceIntegration;
  let serviceNoScope: TestServiceIntegration;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    serviceA = await createTestServiceIntegration("SENGOKU_PASSPORT", {
      allowedScopes: SCOPES,
    });
    serviceB = await createTestServiceIntegration("AIART", {
      allowedScopes: SCOPES,
    });
    serviceNoScope = await createTestServiceIntegration("SENGOKU_METAVERSE", {
      allowedScopes: [],
    });
    // PR-W3-b: LEARNING_JOURNEY_REWARDはreward_rules必須(fail-closed)になったため、
    // grantViaServiceA()が使うSENGOKU_LEARNING_JOURNEY_REWARDルールを用意しておく。
    await prisma.rewardRule.upsert({
      where: { ruleCode: "SENGOKU_LEARNING_JOURNEY_REWARD" },
      update: { status: "ACTIVE" },
      create: {
        id: generateId(),
        ruleCode: "SENGOKU_LEARNING_JOURNEY_REWARD",
        ruleName: "はじまりの旅 特典 (照合APIテスト用)",
        sourceService: "SENGOKU_PASSPORT",
        rewardAmount: 100,
        approvalType: "AUTOMATIC",
        status: "ACTIVE",
        displayName: "はじまりの旅 特典",
      },
    });
  });

  afterAll(async () => {
    await prisma.rewardRule.deleteMany({
      where: { ruleCode: "SENGOKU_LEARNING_JOURNEY_REWARD" },
    });
    await app.close();
    await prisma.$disconnect();
  });

  async function grantViaServiceA(
    overrides: Partial<Record<string, unknown>> = {},
  ) {
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
    return {
      externalUserId,
      idempotencyKey,
      transactionId: res.body.id as string,
    };
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

    it("transactions.read scopeが無ければ403になる", async () => {
      const path = `/api/v1/service/transactions/by-idempotency-key/anything`;

      await request(app.getHttpServer())
        .get(path)
        .set(signedHeaders(serviceNoScope, "GET", path, {}))
        .expect(403);
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
      expect(res.text).toContain(
        "transaction_id,idempotency_key,external_user_id,amount,transaction_type,rule_code,occurred_at,status",
      );
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
        .set(
          signedHeaders(serviceB, "POST", "/api/v1/rewards/grant", grantBodyB),
        )
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

    it("period_from > period_toは400になる", async () => {
      const periodFrom = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const periodTo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const path = `/api/v1/service/transactions/export?period_from=${encodeURIComponent(periodFrom)}&period_to=${encodeURIComponent(periodTo)}`;

      await request(app.getHttpServer())
        .get(path)
        .set(signedHeaders(serviceA, "GET", path, {}))
        .expect(400);
    });

    it("照会期間が92日を超えると400になる", async () => {
      const periodFrom = new Date(
        Date.now() - 100 * 24 * 60 * 60 * 1000,
      ).toISOString();
      const periodTo = new Date().toISOString();
      const path = `/api/v1/service/transactions/export?period_from=${encodeURIComponent(periodFrom)}&period_to=${encodeURIComponent(periodTo)}`;

      await request(app.getHttpServer())
        .get(path)
        .set(signedHeaders(serviceA, "GET", path, {}))
        .expect(400);
    });

    it("transactions.export scopeが無ければ403になる", async () => {
      const periodFrom = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const periodTo = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const path = `/api/v1/service/transactions/export?period_from=${encodeURIComponent(periodFrom)}&period_to=${encodeURIComponent(periodTo)}`;

      await request(app.getHttpServer())
        .get(path)
        .set(signedHeaders(serviceNoScope, "GET", path, {}))
        .expect(403);
    });

    it("不正なcursorは400になる", async () => {
      const path = `/api/v1/service/transactions/export?period_from=${encodeURIComponent(new Date(Date.now() - 60 * 60 * 1000).toISOString())}&period_to=${encodeURIComponent(new Date(Date.now() + 60 * 60 * 1000).toISOString())}&cursor=not-a-valid-cursor`;

      await request(app.getHttpServer())
        .get(path)
        .set(signedHeaders(serviceA, "GET", path, {}))
        .expect(400);
    });

    it("外部ユーザーが制御する値がExcel数式として解釈されないようエスケープされる", async () => {
      // external_user_idは連携先が自由に指定できる値。AccountLink経由でCSVへ
      // 反映されるため、先頭が「=」等でもCSVインジェクションにならないことを確認する。
      const formulaLikeExternalUserId = `=cmd|'/c calc'!A1-${generateId()}`;
      const idempotencyKey = `IDEM-${generateId()}`;
      const grantBody = {
        service_code: "SENGOKU_PASSPORT",
        external_user_id: formulaLikeExternalUserId,
        event_type: "LEARNING_MISSION_COMPLETED",
        event_id: `MISSION-${generateId()}`,
        amount: 100,
        transaction_type: "LEARNING_JOURNEY_REWARD",
        display_name: "はじまりの旅 特典",
        idempotency_key: idempotencyKey,
      };
      await request(app.getHttpServer())
        .post("/api/v1/rewards/grant")
        .set(
          signedHeaders(serviceA, "POST", "/api/v1/rewards/grant", grantBody),
        )
        .send(grantBody)
        .expect(201);

      const periodFrom = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const periodTo = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const path = `/api/v1/service/transactions/export?period_from=${encodeURIComponent(periodFrom)}&period_to=${encodeURIComponent(periodTo)}`;

      const res = await request(app.getHttpServer())
        .get(path)
        .set(signedHeaders(serviceA, "GET", path, {}))
        .expect(200);

      expect(res.text).not.toContain(`,${formulaLikeExternalUserId},`);
      expect(res.text).toContain(`,'${formulaLikeExternalUserId},`);
    });

    it("1ページに収まる件数のときはX-Has-More: falseで、X-Next-Cursorは付与されない", async () => {
      const periodFrom = new Date(Date.now() - 60 * 60 * 1000).toISOString();

      const first = await grantViaServiceA();
      const second = await grantViaServiceA();
      const periodTo = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      const basePath = `/api/v1/service/transactions/export?period_from=${encodeURIComponent(periodFrom)}&period_to=${encodeURIComponent(periodTo)}`;

      const fullRes = await request(app.getHttpServer())
        .get(basePath)
        .set(signedHeaders(serviceA, "GET", basePath, {}))
        .expect(200);
      expect(fullRes.headers["x-has-more"]).toBe("false");
      expect(fullRes.headers["x-next-cursor"]).toBeUndefined();
      expect(fullRes.text).toContain(first.idempotencyKey);
      expect(fullRes.text).toContain(second.idempotencyKey);
    });

    it("cursorで指定した取引より後(occurred_at, id昇順)だけが返る", async () => {
      // 10,000件超をseedして本物のページ境界を再現するのは非現実的なため、
      // サーバーが実際に払い出すレスポンス形式(base64url化されたJSON)を模した
      // cursorを渡し、キーセットフィルタ(occurred_at, id)自体の正しさを検証する。
      const first = await grantViaServiceA();
      const second = await grantViaServiceA();

      const firstTx = await prisma.oveTransaction.findUniqueOrThrow({
        where: { idempotencyKey: first.idempotencyKey },
      });
      const cursor = Buffer.from(
        JSON.stringify({
          occurredAt: firstTx.occurredAt.toISOString(),
          id: firstTx.id,
        }),
        "utf8",
      ).toString("base64url");

      const periodFrom = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const periodTo = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const path = `/api/v1/service/transactions/export?period_from=${encodeURIComponent(periodFrom)}&period_to=${encodeURIComponent(periodTo)}&cursor=${cursor}`;

      const res = await request(app.getHttpServer())
        .get(path)
        .set(signedHeaders(serviceA, "GET", path, {}))
        .expect(200);

      expect(res.text).not.toContain(first.idempotencyKey);
      expect(res.text).toContain(second.idempotencyKey);
    });
  });
});
