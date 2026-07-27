import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { hashSecret } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { createTestServiceIntegration, signedHeaders, type TestServiceIntegration } from "./test-helpers";

const DEBIT_PATH = "/api/v1/transactions/debit";

describe("APIアクセスログ (指示書13章)", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let integration: TestServiceIntegration;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    integration = await createTestServiceIntegration("SENGOKU_EC", { perRequestAmountLimit: 1_000_000 });

    const adminEmail = `e2e-apilog-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E ApiAccessLog Admin",
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

  it("records a successful (post-auth business error) call and an auth-failure call, both visible via the admin list", async () => {
    // 残高不足で 409 になる想定 (認証は成功するので ApiAccessLogInterceptor が記録する)
    const body = {
      service_code: "SENGOKU_EC",
      external_user_id: `debit-user-${generateId()}`,
      amount: 500,
      display_name: "APIアクセスログテスト",
      idempotency_key: `apilog-debit-${generateId()}`,
    };
    const debitRes = await request(app.getHttpServer())
      .post(DEBIT_PATH)
      .set(signedHeaders(integration, "POST", DEBIT_PATH, body))
      .send(body);
    // アカウント未連携のため 404 (認証は成功しているのでインターセプタが記録する)
    expect(debitRes.status).toBe(404);

    // 不正な署名 (認証失敗、Guard 側で記録する)
    const badHeaders = signedHeaders(integration, "POST", DEBIT_PATH, body);
    badHeaders["X-OVE-Signature"] = "invalid-signature";
    await request(app.getHttpServer()).post(DEBIT_PATH).set(badHeaders).send(body).expect(401);

    const listRes = await request(app.getHttpServer())
      .get(`/api/v1/admin/api-access-logs?serviceIntegrationId=${integration.id}&limit=50`)
      .set("Cookie", adminCookie)
      .expect(200);

    expect(listRes.body.length).toBeGreaterThanOrEqual(2);
    expect(listRes.body.every((l: { serviceIntegrationId: string }) => l.serviceIntegrationId === integration.id)).toBe(
      true,
    );

    const authFailureLog = listRes.body.find((l: { statusCode: number }) => l.statusCode === 401);
    expect(authFailureLog).toBeDefined();
    expect(authFailureLog.errorMessage).toBeTruthy();

    const businessOutcomeLog = listRes.body.find((l: { statusCode: number }) => l.statusCode === debitRes.status);
    expect(businessOutcomeLog).toBeDefined();
    expect(businessOutcomeLog.serviceCode).toBe("SENGOKU_EC");

    // statusCode フィルタでも絞り込めること
    const filtered = await request(app.getHttpServer())
      .get(`/api/v1/admin/api-access-logs?serviceIntegrationId=${integration.id}&statusCode=401`)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(filtered.body.length).toBeGreaterThanOrEqual(1);
    expect(filtered.body.every((l: { statusCode: number }) => l.statusCode === 401)).toBe(true);
  });

  it("admin以外の権限では 403 になる", async () => {
    const email = `e2e-apilog-operator-${generateId()}@ovewallet.local`;
    const password = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email,
        passwordHash: hashSecret(password),
        role: "OVE_OPERATOR",
        displayName: "E2E ApiAccessLog Operator",
      },
    });
    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email, password })
      .expect(201);
    const operatorCookie = loginRes.headers["set-cookie"] as unknown as string[];

    await request(app.getHttpServer())
      .get("/api/v1/admin/api-access-logs")
      .set("Cookie", operatorCookie)
      .expect(403);
  });
});
