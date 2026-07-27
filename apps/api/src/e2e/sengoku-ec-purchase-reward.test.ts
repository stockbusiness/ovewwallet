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
const RULE_CODE = "SENGOKU_EC_PURCHASE_REWARD"; // rewards.service.ts の RULE_CODE_BY_TRANSACTION_TYPE に合わせる

async function grant(
  server: Parameters<typeof request>[0],
  integration: TestServiceIntegration,
  body: Record<string, unknown>,
) {
  const headers = signedHeaders(integration, "POST", GRANT_PATH, body);
  return request(server).post(GRANT_PATH).set(headers).send(body);
}

describe("transaction_type: SENGOKU_EC_PURCHASE (戦国EC購入特典)", () => {
  let app: INestApplication;
  let integration: TestServiceIntegration;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    integration = await createTestServiceIntegration("SENGOKU_EC", { perRequestAmountLimit: 1_000_000 });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.rewardRule.deleteMany({ where: { ruleCode: RULE_CODE } });
  });

  it("grants successfully even when no reward_rules row is registered yet (no per_user/per_event/monthly/global enforcement)", async () => {
    const externalUserId = `ec-unregistered-${generateId()}`;
    const res = await grant(app.getHttpServer(), integration, {
      service_code: "SENGOKU_EC",
      external_user_id: externalUserId,
      event_type: "PURCHASE",
      event_id: `ORDER-${generateId()}`,
      amount: 500,
      transaction_type: "SENGOKU_EC_PURCHASE",
      display_name: "戦国EC購入特典",
      idempotency_key: `key-${generateId()}`,
    });

    expect(res.status).toBe(201);
    expect(res.body.transaction_type).toBe("SENGOKU_EC_PURCHASE");
    expect(res.body.status).toBe("COMPLETED");
  });

  it("enforces reward_rules limits once a SENGOKU_EC_PURCHASE_REWARD rule is registered", async () => {
    await prisma.rewardRule.create({
      data: {
        id: generateId(),
        ruleCode: RULE_CODE,
        ruleName: "戦国EC購入特典 (テスト)",
        sourceService: "SENGOKU_EC",
        rewardAmount: 500,
        approvalType: "AUTOMATIC",
        status: "ACTIVE",
        displayName: "戦国EC購入特典",
        perEventLimit: 1,
      },
    });

    const externalUserId = `ec-limited-${generateId()}`;
    const eventId = `ORDER-${generateId()}`;
    const body = {
      service_code: "SENGOKU_EC",
      external_user_id: externalUserId,
      event_type: "PURCHASE",
      event_id: eventId,
      amount: 500,
      transaction_type: "SENGOKU_EC_PURCHASE",
      display_name: "戦国EC購入特典",
    };

    const first = await grant(app.getHttpServer(), integration, {
      ...body,
      idempotency_key: `key-a-${generateId()}`,
    });
    expect(first.status).toBe(201);

    // 同一event_idで別のidempotency_keyから再度付与しようとするとper_event_limitで拒否される
    const second = await grant(app.getHttpServer(), integration, {
      ...body,
      idempotency_key: `key-b-${generateId()}`,
    });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe("VALIDATION_ERROR");
    expect(second.body.error.message).toMatch(/per_event_limit/);
  });
});
