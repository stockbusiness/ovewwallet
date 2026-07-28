import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { hashSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { createTestServiceIntegration, signedHeaders, type TestServiceIntegration } from "./test-helpers";

const GRANT_PATH = "/api/v1/rewards/grant";
const RULE_CODE = "AIART_ATTENDANCE_REWARD"; // rewards.service.ts の固定マッピングに合わせる

async function grant(
  server: Parameters<typeof request>[0],
  integration: TestServiceIntegration,
  body: Record<string, unknown>,
) {
  const headers = signedHeaders(integration, "POST", GRANT_PATH, body);
  return request(server).post(GRANT_PATH).set(headers).send(body);
}

/** 付与ルール別発行量集計 (GET /api/v1/admin/reward-rules/issuance-summary)。 */
describe("付与ルール別発行量集計", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let integration: TestServiceIntegration;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    integration = await createTestServiceIntegration("AIART", { perRequestAmountLimit: 1_000_000 });

    await prisma.rewardRule.upsert({
      where: { ruleCode: RULE_CODE },
      update: {
        status: "ACTIVE",
        startsAt: null,
        endsAt: null,
        perUserLimit: null,
        perEventLimit: null,
        monthlyCountLimit: null,
        monthlyAmountLimit: null,
        globalAmountLimit: null,
      },
      create: {
        id: generateId(),
        ruleCode: RULE_CODE,
        ruleName: "AIアート教室参加特典",
        sourceService: "AIART",
        rewardAmount: 10000,
        approvalType: "AUTOMATIC",
        status: "ACTIVE",
        displayName: "AIアート教室参加特典",
      },
    });

    const adminEmail = `e2e-issuance-admin-${generateId()}@ovewallet.local`;
    const adminPassword = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "E2E Issuance Summary Admin",
      },
    });
    const adminLogin = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password: adminPassword })
      .expect(201);
    adminCookie = adminLogin.headers["set-cookie"] as unknown as string[];
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("マッピングされたルールは累計発行額・件数を返し、マッピングの無いルールはnullを返す", async () => {
    const server = app.getHttpServer();

    const customRuleCode = `E2E_ISSUANCE_CUSTOM_${generateId()}`;
    await request(server)
      .post("/api/v1/admin/reward-rules")
      .set("Cookie", adminCookie)
      .send({
        ruleCode: customRuleCode,
        ruleName: "対応表に無いルール",
        sourceService: "EVENT_SYSTEM",
        rewardAmount: 100,
        displayName: "テスト",
      })
      .expect(201);

    const grantRes = await grant(server, integration, {
      service_code: "AIART",
      external_user_id: `e2e-issuance-${generateId()}`,
      transaction_type: "AIART_ATTENDANCE",
      amount: 10000,
      event_type: "attendance",
      event_id: generateId(),
      idempotency_key: generateId(),
      display_name: "e2e issuance summary",
    });
    expect(grantRes.status).toBe(201);

    const res = await request(server)
      .get("/api/v1/admin/reward-rules/issuance-summary")
      .set("Cookie", adminCookie)
      .expect(200);

    const mapped = res.body.find((r: { ruleCode: string }) => r.ruleCode === RULE_CODE);
    expect(mapped.totalAmount).not.toBeNull();
    expect(Number(mapped.totalAmount)).toBeGreaterThanOrEqual(10000);
    expect(mapped.count).toBeGreaterThanOrEqual(1);

    const unmapped = res.body.find((r: { ruleCode: string }) => r.ruleCode === customRuleCode);
    expect(unmapped.totalAmount).toBeNull();
    expect(unmapped.count).toBeNull();
  });
});
