import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
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

describe("reward rule limits (monthly / global / period)", () => {
  let app: INestApplication;
  let integration: TestServiceIntegration;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    integration = await createTestServiceIntegration("AIART", { perRequestAmountLimit: 1_000_000 });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("rejects a grant before the rule's starts_at", async () => {
    await prisma.rewardRule.upsert({
      where: { ruleCode: RULE_CODE },
      update: { startsAt: new Date(Date.now() + 60_000), endsAt: null, status: "ACTIVE" },
      create: {
        id: generateId(),
        ruleCode: RULE_CODE,
        ruleName: "test",
        sourceService: "AIART",
        rewardAmount: 10000,
        approvalType: "AUTOMATIC",
        status: "ACTIVE",
        displayName: "test",
        startsAt: new Date(Date.now() + 60_000),
      },
    });

    const externalUserId = `future-${generateId()}`;
    const res = await grant(app.getHttpServer(), integration, {
      service_code: "AIART",
      external_user_id: externalUserId,
      event_type: "ATTENDANCE",
      event_id: `EVT-${generateId()}`,
      amount: 1000,
      transaction_type: "AIART_ATTENDANCE",
      display_name: "test",
      idempotency_key: `key-${generateId()}`,
    });

    expect(res.status).toBe(400);
    // /api/v1/rewards/grant は外部連携APIのため {ok:false, error:{code,message}} 形式
    expect(res.body.error.message).toMatch(/has not started yet/);
  });

  it("rejects a grant after the rule's ends_at", async () => {
    await prisma.rewardRule.update({
      where: { ruleCode: RULE_CODE },
      data: { startsAt: new Date(Date.now() - 120_000), endsAt: new Date(Date.now() - 60_000) },
    });

    const externalUserId = `ended-${generateId()}`;
    const res = await grant(app.getHttpServer(), integration, {
      service_code: "AIART",
      external_user_id: externalUserId,
      event_type: "ATTENDANCE",
      event_id: `EVT-${generateId()}`,
      amount: 1000,
      transaction_type: "AIART_ATTENDANCE",
      display_name: "test",
      idempotency_key: `key-${generateId()}`,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/already ended/);
  });

  it("enforces monthly_amount_limit relative to the current baseline", async () => {
    const baseline = await prisma.oveTransaction.aggregate({
      where: { transactionType: "AIART_ATTENDANCE", status: "COMPLETED", occurredAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } },
      _sum: { amount: true },
    });
    const baselineSum = baseline._sum.amount ?? 0n;

    await prisma.rewardRule.update({
      where: { ruleCode: RULE_CODE },
      data: { startsAt: null, endsAt: null, monthlyAmountLimit: baselineSum + 5000n, globalAmountLimit: null },
    });

    const userA = `monthly-a-${generateId()}`;
    const okRes = await grant(app.getHttpServer(), integration, {
      service_code: "AIART",
      external_user_id: userA,
      event_type: "ATTENDANCE",
      event_id: `EVT-${generateId()}`,
      amount: 3000,
      transaction_type: "AIART_ATTENDANCE",
      display_name: "test",
      idempotency_key: `key-${generateId()}`,
    });
    expect(okRes.status).toBe(201);

    const userB = `monthly-b-${generateId()}`;
    const failRes = await grant(app.getHttpServer(), integration, {
      service_code: "AIART",
      external_user_id: userB,
      event_type: "ATTENDANCE",
      event_id: `EVT-${generateId()}`,
      amount: 3000,
      transaction_type: "AIART_ATTENDANCE",
      display_name: "test",
      idempotency_key: `key-${generateId()}`,
    });
    expect(failRes.status).toBe(400);
    expect(failRes.body.error.message).toMatch(/monthly_amount_limit/);
  });

  it("enforces global_amount_limit relative to the current baseline", async () => {
    const baseline = await prisma.oveTransaction.aggregate({
      where: { transactionType: "AIART_ATTENDANCE", status: "COMPLETED" },
      _sum: { amount: true },
    });
    const baselineSum = baseline._sum.amount ?? 0n;

    await prisma.rewardRule.update({
      where: { ruleCode: RULE_CODE },
      data: { monthlyAmountLimit: null, globalAmountLimit: baselineSum + 2000n },
    });

    const userC = `global-c-${generateId()}`;
    const okRes = await grant(app.getHttpServer(), integration, {
      service_code: "AIART",
      external_user_id: userC,
      event_type: "ATTENDANCE",
      event_id: `EVT-${generateId()}`,
      amount: 1500,
      transaction_type: "AIART_ATTENDANCE",
      display_name: "test",
      idempotency_key: `key-${generateId()}`,
    });
    expect(okRes.status).toBe(201);

    const userD = `global-d-${generateId()}`;
    const failRes = await grant(app.getHttpServer(), integration, {
      service_code: "AIART",
      external_user_id: userD,
      event_type: "ATTENDANCE",
      event_id: `EVT-${generateId()}`,
      amount: 1500,
      transaction_type: "AIART_ATTENDANCE",
      display_name: "test",
      idempotency_key: `key-${generateId()}`,
    });
    expect(failRes.status).toBe(400);
    expect(failRes.body.error.message).toMatch(/global_amount_limit/);
  });
});
