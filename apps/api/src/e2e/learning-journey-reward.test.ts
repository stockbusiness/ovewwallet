import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { prisma, generateId } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { createTestServiceIntegration, signedHeaders, type TestServiceIntegration } from "./test-helpers";

const GRANT_PATH = "/api/v1/rewards/grant";
const RULE_CODE = "SENGOKU_LEARNING_JOURNEY_REWARD"; // rewards.service.ts の RULE_CODE_BY_TRANSACTION_TYPE に合わせる

async function grant(
  server: Parameters<typeof request>[0],
  integration: TestServiceIntegration,
  body: Record<string, unknown>,
) {
  const headers = signedHeaders(integration, "POST", GRANT_PATH, body);
  return request(server).post(GRANT_PATH).set(headers).send(body);
}

/**
 * 千ノ国パスポート「はじまりの旅」学習ミッション専用のtransaction_type。
 * 他のイベント報酬 (EVENT_REWARD等) と区別するために新設 (PR-Learning-Journey-01)。
 */
describe("transaction_type: LEARNING_JOURNEY_REWARD (千ノ国パスポート「はじまりの旅」)", () => {
  let app: INestApplication;
  let integration: TestServiceIntegration;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    integration = await createTestServiceIntegration("SENGOKU_PASSPORT", { perRequestAmountLimit: 1_000_000 });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.rewardRule.deleteMany({ where: { ruleCode: RULE_CODE } });
  });

  it("grants successfully even when no reward_rules row is registered yet (no per_user/per_event/monthly/global enforcement)", async () => {
    const externalUserId = `learning-journey-unregistered-${generateId()}`;
    const res = await grant(app.getHttpServer(), integration, {
      service_code: "SENGOKU_PASSPORT",
      external_user_id: externalUserId,
      event_type: "LEARNING_MISSION_COMPLETED",
      event_id: `MISSION-${generateId()}`,
      amount: 100,
      transaction_type: "LEARNING_JOURNEY_REWARD",
      display_name: "はじまりの旅 特典",
      idempotency_key: `key-${generateId()}`,
    });

    expect(res.status).toBe(201);
    expect(res.body.transaction_type).toBe("LEARNING_JOURNEY_REWARD");
    expect(res.body.status).toBe("COMPLETED");
  });

  it("enforces reward_rules limits once a SENGOKU_LEARNING_JOURNEY_REWARD rule is registered", async () => {
    await prisma.rewardRule.create({
      data: {
        id: generateId(),
        ruleCode: RULE_CODE,
        ruleName: "はじまりの旅 特典 (テスト)",
        sourceService: "SENGOKU_PASSPORT",
        rewardAmount: 100,
        approvalType: "AUTOMATIC",
        status: "ACTIVE",
        displayName: "はじまりの旅 特典",
        perEventLimit: 1,
      },
    });

    const externalUserId = `learning-journey-limited-${generateId()}`;
    const eventId = `MISSION-${generateId()}`;
    const body = {
      service_code: "SENGOKU_PASSPORT",
      external_user_id: externalUserId,
      event_type: "LEARNING_MISSION_COMPLETED",
      event_id: eventId,
      amount: 100,
      transaction_type: "LEARNING_JOURNEY_REWARD",
      display_name: "はじまりの旅 特典",
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
