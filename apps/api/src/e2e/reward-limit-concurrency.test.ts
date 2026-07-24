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
const RULE_CODE = "AIART_ATTENDANCE_REWARD";

async function grant(
  server: Parameters<typeof request>[0],
  integration: TestServiceIntegration,
  body: Record<string, unknown>,
) {
  const headers = signedHeaders(integration, "POST", GRANT_PATH, body);
  return request(server).post(GRANT_PATH).set(headers).send(body);
}

/**
 * モジュール化後レビュー対応 P1-3: 上限判定(reward_rules集計)とCREDITが別トランザクション
 * だと、同時リクエストで`global_amount_limit`を突破できてしまう不整合があった。
 * `GrantRewardUseCase`が`reward_rules`行を`FOR UPDATE`でロックしてから同一トランザクション内で
 * 判定・CREDITするようになったことで、並行付与でも上限を超えないことを検証する。
 */
describe("reward rule limits: 並行付与でも上限を突破しない (P1-3回帰)", () => {
  let app: INestApplication;
  let integration: TestServiceIntegration;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    integration = await createTestServiceIntegration("AIART", { perRequestAmountLimit: 1_000_000 });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("global_amount_limitちょうど1件分の余地しかない状態で5件同時付与しても、成功は1件だけ", async () => {
    const baseline = await prisma.oveTransaction.aggregate({
      where: { transactionType: "AIART_ATTENDANCE", status: "COMPLETED" },
      _sum: { amount: true },
    });
    const baselineSum = baseline._sum.amount ?? 0n;
    const grantAmount = 1000;

    await prisma.rewardRule.upsert({
      where: { ruleCode: RULE_CODE },
      update: { startsAt: null, endsAt: null, monthlyAmountLimit: null, globalAmountLimit: baselineSum + BigInt(grantAmount) },
      create: {
        id: generateId(),
        ruleCode: RULE_CODE,
        ruleName: "test",
        sourceService: "AIART",
        rewardAmount: 10000,
        approvalType: "AUTOMATIC",
        status: "ACTIVE",
        displayName: "test",
        globalAmountLimit: baselineSum + BigInt(grantAmount),
      },
    });

    const concurrency = 5;
    const results = await Promise.all(
      Array.from({ length: concurrency }, (_, i) =>
        grant(app.getHttpServer(), integration, {
          service_code: "AIART",
          external_user_id: `concurrent-${i}-${generateId()}`,
          event_type: "ATTENDANCE",
          event_id: `EVT-${generateId()}`,
          amount: grantAmount,
          transaction_type: "AIART_ATTENDANCE",
          display_name: "test",
          idempotency_key: `key-${generateId()}`,
        }),
      ),
    );

    const successCount = results.filter((r) => r.status === 201).length;
    const rejectedCount = results.filter((r) => r.status === 400).length;
    expect(successCount).toBe(1);
    expect(rejectedCount).toBe(concurrency - 1);

    const finalSum = await prisma.oveTransaction.aggregate({
      where: { transactionType: "AIART_ATTENDANCE", status: "COMPLETED" },
      _sum: { amount: true },
    });
    expect((finalSum._sum.amount ?? 0n) - baselineSum).toBe(BigInt(grantAmount));
  });
});
