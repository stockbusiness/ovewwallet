import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { hashSecret } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { createTestServiceIntegration, signedHeaders } from "./test-helpers";

describe("service integration emergency stop", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `e2e-suspend-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Suspend Admin",
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

  it("rejects API requests from a service integration after it is suspended, and accepts again after reactivation", async () => {
    const integration = await createTestServiceIntegration("SENGOKU_GACHA");

    const body = {
      service_code: "SENGOKU_GACHA",
      external_user_id: `suspend-test-${generateId()}`,
      event_type: "TEST",
      event_id: `EVT-${generateId()}`,
      amount: 100,
      transaction_type: "EVENT_REWARD",
      display_name: "test",
      idempotency_key: `key-${generateId()}`,
    };
    const path = "/api/v1/rewards/grant";

    const beforeSuspend = await request(app.getHttpServer())
      .post(path)
      .set(signedHeaders(integration, "POST", path, body))
      .send(body);
    expect(beforeSuspend.status).toBe(201);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/service-integrations/${integration.id}/suspend`)
      .set("Cookie", adminCookie)
      .send({ reason: "不正利用の疑いのため緊急停止" })
      .expect(201);

    const body2 = { ...body, idempotency_key: `key-${generateId()}` };
    const afterSuspend = await request(app.getHttpServer())
      .post(path)
      .set(signedHeaders(integration, "POST", path, body2))
      .send(body2);
    expect(afterSuspend.status).toBe(401);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/service-integrations/${integration.id}/reactivate`)
      .set("Cookie", adminCookie)
      .send({ reason: "調査完了のため再開" })
      .expect(201);

    const body3 = { ...body, idempotency_key: `key-${generateId()}` };
    const afterReactivate = await request(app.getHttpServer())
      .post(path)
      .set(signedHeaders(integration, "POST", path, body3))
      .send(body3);
    expect(afterReactivate.status).toBe(201);

    // createTestServiceIntegration は service_code を key に upsert するため、
    // 複数回テストを実行すると同じ連携行・監査ログが積み上がる。今回分は必ず末尾2件になる。
    const auditLogs = await prisma.auditLog.findMany({
      where: { targetType: "service_integration", targetId: integration.id },
      orderBy: { createdAt: "asc" },
    });
    expect(auditLogs.slice(-2).map((l) => l.actionType)).toEqual([
      "SERVICE_INTEGRATION_SUSPEND",
      "SERVICE_INTEGRATION_REACTIVATE",
    ]);
  });
});
