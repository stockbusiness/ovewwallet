import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { prisma, generateId } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import {
  createTestServiceIntegration,
  signedHeaders,
  type TestServiceIntegration,
} from "./test-helpers";

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
    integration = await createTestServiceIntegration("SENGOKU_PASSPORT", {
      perRequestAmountLimit: 1_000_000,
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.rewardRule.deleteMany({ where: { ruleCode: RULE_CODE } });
  });

  it("PR-W3-b: rejects (fail-closed) when no reward_rules row is registered yet", async () => {
    // 千ノ国パスポートからの依頼により、LEARNING_JOURNEY_REWARDはreward_rules必須
    // (REWARD_RULE_REQUIRED_TRANSACTION_TYPES)。未登録のまま無制限で付与が通っていた
    // 従来の挙動(fail-open)は廃止した。
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

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toMatch(/reward rule .* is required/);
  });

  it("PR-W3-b: rejects (fail-closed) when the reward_rules row exists but is INACTIVE", async () => {
    await prisma.rewardRule.create({
      data: {
        id: generateId(),
        ruleCode: RULE_CODE,
        ruleName: "はじまりの旅 特典 (テスト・停止中)",
        sourceService: "SENGOKU_PASSPORT",
        rewardAmount: 100,
        approvalType: "AUTOMATIC",
        status: "INACTIVE",
        displayName: "はじまりの旅 特典",
      },
    });

    const externalUserId = `learning-journey-inactive-${generateId()}`;
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

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.message).toMatch(/reward rule .* is required/);
  });

  it("PR-W3-b: other transaction_types keep the existing fail-open behavior (opt-in only)", async () => {
    // REWARD_RULE_REQUIRED_TRANSACTION_TYPESに含まれないtransaction_typeは、
    // reward_rules未登録でも従来通り付与が通る(全面的なfail-closed化ではないことの回帰確認)。
    const externalUserId = `aiart-unregistered-${generateId()}`;
    const res = await grant(app.getHttpServer(), integration, {
      service_code: "SENGOKU_PASSPORT",
      external_user_id: externalUserId,
      event_type: "ATTENDANCE",
      event_id: `EVT-${generateId()}`,
      amount: 100,
      transaction_type: "SENGOKU_EC_PURCHASE",
      display_name: "戦国EC購入特典",
      idempotency_key: `key-${generateId()}`,
    });

    expect(res.status).toBe(201);
    expect(res.body.transaction_type).toBe("SENGOKU_EC_PURCHASE");
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
