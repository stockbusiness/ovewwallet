import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { prisma, generateId, type ServiceIntegration } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { GrantExternalServiceRewardUseCase } from "../rewards/grant-external-service-reward.use-case";
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

async function todaysGrantedSum(serviceCode: string): Promise<bigint> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const result = await prisma.oveTransaction.aggregate({
    where: { sourceService: serviceCode, status: "COMPLETED", direction: "CREDIT", occurredAt: { gte: todayStart } },
    _sum: { amount: true },
  });
  return result._sum.amount ?? 0n;
}

// このファイル内の全describeブロックで1つのNestJSアプリを共有する (`KeyValueStoreModule`の
// Redisクライアントがモジュールスコープのシングルトンであり、`app.close()`のたびに
// `quit()`されるため、複数の独立したアプリインスタンスを同一ファイル内で作成・close
// すると、後続のブロックが「Connection is closed」エラーになる)。
let app: INestApplication;

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  app.use(cookieParser());
  app.useGlobalFilters(new LedgerExceptionFilter());
  await app.init();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

/**
 * モジュール化後レビュー対応 P1-3: 上限判定(reward_rules集計)とCREDITが別トランザクション
 * だと、同時リクエストで`global_amount_limit`を突破できてしまう不整合があった。
 * `GrantRewardUseCase`が`reward_rules`行を`FOR UPDATE`でロックしてから同一トランザクション内で
 * 判定・CREDITするようになったことで、並行付与でも上限を超えないことを検証する。
 */
describe("reward rule limits: 並行付与でも上限を突破しない (P1-3回帰)", () => {
  let integration: TestServiceIntegration;

  beforeAll(async () => {
    integration = await createTestServiceIntegration("AIART", { perRequestAmountLimit: 1_000_000 });
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

/**
 * 追加整合性対策 P0-3: `ServiceIntegration.dailyAmountLimit`の判定 (日次付与合計の集計)と
 * CREDITが別トランザクションだと、同一サービスからの並行リクエストで日次上限を突破しうる
 * 不整合があった。`GrantExternalServiceRewardUseCase`がServiceIntegration行を`FOR UPDATE`で
 * ロックしてから同一トランザクション内で集計・CREDITするようになったことを検証する。
 */
describe("ServiceIntegration日次上限: 並行付与でも突破しない (追加整合性対策 P0-3回帰)", () => {
  beforeAll(async () => {
    // transaction_type "AIART_ATTENDANCE" は RULE_CODE_BY_TRANSACTION_TYPE により
    // reward_rules "AIART_ATTENDANCE_REWARD" にも自動的に紐づく。他describeブロック
    // (P1-3回帰) がこのルールのglobalAmountLimitを既に使い切った状態にしているため、
    // ServiceIntegration側の制約だけを検証したいテストがRewardRule側の制約で
    // 誤って失敗しないよう、上限を解除しておく (「デッドロック」テストは自分で
    // 明示的に上限を再設定するため影響を受けない)。
    await prisma.rewardRule.updateMany({
      where: { ruleCode: RULE_CODE },
      data: { globalAmountLimit: null, monthlyAmountLimit: null },
    });
  });

  it("日次残り1件分の余地しかない状態で5件同時付与しても、成功は1件だけ", async () => {
    const serviceCode = `AIART`;
    const grantAmount = 500;
    const grantedToday = await todaysGrantedSum(serviceCode);
    const integration = await createTestServiceIntegration(serviceCode, {
      perRequestAmountLimit: 1_000_000,
      dailyAmountLimit: Number(grantedToday) + grantAmount,
    });

    const concurrency = 5;
    const results = await Promise.all(
      Array.from({ length: concurrency }, (_, i) =>
        grant(app.getHttpServer(), integration, {
          service_code: serviceCode,
          external_user_id: `daily-limit-${i}-${generateId()}`,
          event_type: "ATTENDANCE",
          event_id: `EVT-${generateId()}`,
          amount: grantAmount,
          transaction_type: "AIART_ATTENDANCE",
          display_name: "test",
          idempotency_key: `key-daily-${i}-${generateId()}`,
        }),
      ),
    );

    const successCount = results.filter((r) => r.status === 201).length;
    const rejectedCount = results.filter((r) => r.status === 400).length;
    expect(successCount).toBe(1);
    expect(rejectedCount).toBe(concurrency - 1);

    const finalSum = await todaysGrantedSum(serviceCode);
    expect(finalSum - grantedToday).toBe(BigInt(grantAmount));
  });

  it("perRequestAmountLimitを超える金額はCREDITされない", async () => {
    const integration = await createTestServiceIntegration("AIART", { perRequestAmountLimit: 100, dailyAmountLimit: 1_000_000 });
    const res = await grant(app.getHttpServer(), integration, {
      service_code: "AIART",
      external_user_id: `per-request-${generateId()}`,
      event_type: "ATTENDANCE",
      event_id: `EVT-${generateId()}`,
      amount: 101,
      transaction_type: "AIART_ATTENDANCE",
      display_name: "test",
      idempotency_key: `key-${generateId()}`,
    });
    expect(res.status).toBe(400);
  });

  it("異なるServiceIntegration (service_code) の日次上限は互いに分離される", async () => {
    const grantAmount = 500;
    const serviceCodeA = "AIART";
    const serviceCodeB = "SENGOKU_EC";
    const grantedTodayA = await todaysGrantedSum(serviceCodeA);
    const grantedTodayB = await todaysGrantedSum(serviceCodeB);

    const integrationA = await createTestServiceIntegration(serviceCodeA, {
      perRequestAmountLimit: 1_000_000,
      dailyAmountLimit: Number(grantedTodayA) + grantAmount,
    });
    const integrationB = await createTestServiceIntegration(serviceCodeB, {
      perRequestAmountLimit: 1_000_000,
      dailyAmountLimit: Number(grantedTodayB) + grantAmount * 3,
    });

    // Aは既に上限ちょうど(1件分)、Bは3件分の余地がある状態で、両方に2件ずつ同時付与する。
    const results = await Promise.all([
      grant(app.getHttpServer(), integrationA, {
        service_code: serviceCodeA,
        external_user_id: `isolation-a-1-${generateId()}`,
        event_type: "ATTENDANCE",
        event_id: `EVT-${generateId()}`,
        amount: grantAmount,
        transaction_type: "AIART_ATTENDANCE",
        display_name: "test",
        idempotency_key: `key-a1-${generateId()}`,
      }),
      grant(app.getHttpServer(), integrationA, {
        service_code: serviceCodeA,
        external_user_id: `isolation-a-2-${generateId()}`,
        event_type: "ATTENDANCE",
        event_id: `EVT-${generateId()}`,
        amount: grantAmount,
        transaction_type: "AIART_ATTENDANCE",
        display_name: "test",
        idempotency_key: `key-a2-${generateId()}`,
      }),
      grant(app.getHttpServer(), integrationB, {
        service_code: serviceCodeB,
        external_user_id: `isolation-b-1-${generateId()}`,
        event_type: "PURCHASE",
        event_id: `EVT-${generateId()}`,
        amount: grantAmount,
        transaction_type: "SENGOKU_EC_PURCHASE",
        display_name: "test",
        idempotency_key: `key-b1-${generateId()}`,
      }),
      grant(app.getHttpServer(), integrationB, {
        service_code: serviceCodeB,
        external_user_id: `isolation-b-2-${generateId()}`,
        event_type: "PURCHASE",
        event_id: `EVT-${generateId()}`,
        amount: grantAmount,
        transaction_type: "SENGOKU_EC_PURCHASE",
        display_name: "test",
        idempotency_key: `key-b2-${generateId()}`,
      }),
    ]);

    const [resA1, resA2, resB1, resB2] = results;
    const aSuccessCount = [resA1, resA2].filter((r) => r!.status === 201).length;
    const bSuccessCount = [resB1, resB2].filter((r) => r!.status === 201).length;
    expect(aSuccessCount).toBe(1); // Aは1件分の余地しかない
    expect(bSuccessCount).toBe(2); // Bは3件分の余地があるため2件とも成功
  });

  it("同一idempotency keyの再送は日次上限を再消費しない", async () => {
    const serviceCode = "AIART";
    const grantAmount = 500;
    const grantedToday = await todaysGrantedSum(serviceCode);
    const integration = await createTestServiceIntegration(serviceCode, {
      perRequestAmountLimit: 1_000_000,
      dailyAmountLimit: Number(grantedToday) + grantAmount,
    });
    const idempotencyKey = `key-resend-${generateId()}`;
    const body = {
      service_code: serviceCode,
      external_user_id: `resend-${generateId()}`,
      event_type: "ATTENDANCE",
      event_id: `EVT-${generateId()}`,
      amount: grantAmount,
      transaction_type: "AIART_ATTENDANCE",
      display_name: "test",
      idempotency_key: idempotencyKey,
    };

    const first = await grant(app.getHttpServer(), integration, body);
    expect(first.status).toBe(201);

    // 同一idempotency_keyでの再送を複数回行っても、日次上限が再消費されず全て成功する。
    const resends = await Promise.all(Array.from({ length: 3 }, () => grant(app.getHttpServer(), integration, body)));
    expect(resends.every((r) => r.status === 201)).toBe(true);

    const finalSum = await todaysGrantedSum(serviceCode);
    expect(finalSum - grantedToday).toBe(BigInt(grantAmount));
  });

  it("RewardRule上限とServiceIntegration日次上限が同時に適用されてもデッドロックせず、成功は1件だけ", async () => {
    const serviceCode = "AIART";
    const ruleCode = RULE_CODE;
    const grantAmount = 500;

    const ruleBaseline = await prisma.oveTransaction.aggregate({
      where: { transactionType: "AIART_ATTENDANCE", status: "COMPLETED" },
      _sum: { amount: true },
    });
    const ruleBaselineSum = ruleBaseline._sum.amount ?? 0n;
    await prisma.rewardRule.upsert({
      where: { ruleCode },
      update: { startsAt: null, endsAt: null, monthlyAmountLimit: null, globalAmountLimit: ruleBaselineSum + BigInt(grantAmount * 3) },
      create: {
        id: generateId(),
        ruleCode,
        ruleName: "test",
        sourceService: serviceCode,
        rewardAmount: 10000,
        approvalType: "AUTOMATIC",
        status: "ACTIVE",
        displayName: "test",
        globalAmountLimit: ruleBaselineSum + BigInt(grantAmount * 3),
      },
    });

    const grantedToday = await todaysGrantedSum(serviceCode);
    // ServiceIntegration側の日次上限をちょうど1件分に絞り、RewardRule側 (3件分の余地) より
    // 厳しい制約にする。両方のロック (ServiceIntegration→RewardRule→Wallet) が正しい順序で
    // 取得されればデッドロックは起きない。
    const integration = await createTestServiceIntegration(serviceCode, {
      perRequestAmountLimit: 1_000_000,
      dailyAmountLimit: Number(grantedToday) + grantAmount,
    });

    const concurrency = 5;
    const results = await Promise.all(
      Array.from({ length: concurrency }, (_, i) =>
        grant(app.getHttpServer(), integration, {
          service_code: serviceCode,
          external_user_id: `combined-${i}-${generateId()}`,
          event_type: "ATTENDANCE",
          event_id: `EVT-${generateId()}`,
          amount: grantAmount,
          transaction_type: "AIART_ATTENDANCE",
          display_name: "test",
          idempotency_key: `key-combined-${i}-${generateId()}`,
        }),
      ),
    );

    const successCount = results.filter((r) => r.status === 201).length;
    expect(successCount).toBe(1);
  });
});

async function createAccountWithWallet(): Promise<{ accountId: string }> {
  const accountId = generateId();
  await prisma.oveAccount.create({
    data: { id: accountId, accountCode: `OVE-ACC-TEST-${generateId()}`, status: "ACTIVE" },
  });
  await prisma.wallet.create({
    data: { id: generateId(), oveAccountId: accountId, walletCode: `OVE-WLT-TEST-${generateId()}`, status: "ACTIVE" },
  });
  return { accountId };
}

/**
 * PR #1最終修正: `ServiceIntegration`行を`FOR UPDATE`でロックした後も、認証時に取得した
 * 古い`params.serviceIntegration`スナップショットを上限判定へ使っていた回帰があった。
 * ロック後は`ServiceIntegrationRepository.findById`で必ず再取得し、その値だけを使うことを
 * 検証する。`ExternalApiAuthGuard`は認証時点で`status: "ACTIVE"`の行しか通さないため、
 * 「ロック待ち中の変更」を実際のHTTPリクエストのタイミングだけで再現するのは難しい。
 * ここではUseCase自体を直接呼び出し、DBの最新状態と食い違う古いオブジェクトを
 * 明示的に渡すことで、DB最新値が優先されることを確定的に検証する。
 */
describe("ServiceIntegration最新状態の再取得 (PR #1最終修正回帰)", () => {
  let useCase: GrantExternalServiceRewardUseCase;

  beforeAll(() => {
    useCase = app.get(GrantExternalServiceRewardUseCase);
  });

  async function freshIntegration(serviceCode: string, overrides: Partial<{ perRequestAmountLimit: number; dailyAmountLimit: number }> = {}) {
    const integration = await createTestServiceIntegration(serviceCode, overrides);
    return prisma.serviceIntegration.findUniqueOrThrow({ where: { id: integration.id } });
  }

  it("古いServiceIntegrationオブジェクトを渡してもperRequestAmountLimitはDB最新値を使う", async () => {
    const serviceCode = "AIART";
    const staleIntegration = await freshIntegration(serviceCode, { perRequestAmountLimit: 1_000_000, dailyAmountLimit: 1_000_000 });
    // staleIntegrationを取得した後にDB側の上限を引き下げる (ロック待ち中の変更に相当)。
    await prisma.serviceIntegration.update({ where: { id: staleIntegration.id }, data: { perRequestAmountLimit: 100 } });

    const { accountId } = await createAccountWithWallet();
    await expect(
      useCase.execute({
        serviceIntegration: staleIntegration as ServiceIntegration,
        oveAccountId: accountId,
        amount: 500n,
        transactionType: "AIART_ATTENDANCE",
        idempotencyKey: `key-stale-per-request-${generateId()}`,
        displayName: "test",
      }),
    ).rejects.toThrow(/per_request_amount_limit/);
  });

  it("古いServiceIntegrationオブジェクトを渡してもdailyAmountLimitはDB最新値を使う", async () => {
    const serviceCode = "AIART";
    const grantedToday = await todaysGrantedSum(serviceCode);
    const staleIntegration = await freshIntegration(serviceCode, {
      perRequestAmountLimit: 1_000_000,
      dailyAmountLimit: Number(grantedToday) + 100_000,
    });
    // ロック待ち中に日次上限が引き下げられ、既に消化済みの金額を下回った状態を再現する。
    await prisma.serviceIntegration.update({
      where: { id: staleIntegration.id },
      data: { dailyAmountLimit: Number(grantedToday) },
    });

    const { accountId } = await createAccountWithWallet();
    await expect(
      useCase.execute({
        serviceIntegration: staleIntegration as ServiceIntegration,
        oveAccountId: accountId,
        amount: 100n,
        transactionType: "AIART_ATTENDANCE",
        idempotencyKey: `key-stale-daily-${generateId()}`,
        displayName: "test",
      }),
    ).rejects.toThrow(/daily_amount_limit/);
  });

  it("ロック待ち中にstatusがSUSPENDEDへ変更されていればCREDITしない", async () => {
    const serviceCode = "AIART";
    const staleIntegration = await freshIntegration(serviceCode, { perRequestAmountLimit: 1_000_000, dailyAmountLimit: 1_000_000 });
    await prisma.serviceIntegration.update({ where: { id: staleIntegration.id }, data: { status: "SUSPENDED" } });

    const { accountId } = await createAccountWithWallet();
    await expect(
      useCase.execute({
        serviceIntegration: staleIntegration as ServiceIntegration,
        oveAccountId: accountId,
        amount: 100n,
        transactionType: "AIART_ATTENDANCE",
        idempotencyKey: `key-stale-suspended-${generateId()}`,
        displayName: "test",
      }),
    ).rejects.toThrow(/suspended/);

    const transactions = await prisma.oveTransaction.findMany({
      where: { idempotencyKey: { startsWith: "key-stale-suspended-" } },
    });
    expect(transactions).toHaveLength(0);
  });

  it("ロック待ち中にstatusがREVOKEDへ変更されていればCREDITしない", async () => {
    const serviceCode = "AIART";
    const staleIntegration = await freshIntegration(serviceCode, { perRequestAmountLimit: 1_000_000, dailyAmountLimit: 1_000_000 });
    await prisma.serviceIntegration.update({ where: { id: staleIntegration.id }, data: { status: "REVOKED" } });

    const { accountId } = await createAccountWithWallet();
    await expect(
      useCase.execute({
        serviceIntegration: staleIntegration as ServiceIntegration,
        oveAccountId: accountId,
        amount: 100n,
        transactionType: "AIART_ATTENDANCE",
        idempotencyKey: `key-stale-revoked-${generateId()}`,
        displayName: "test",
      }),
    ).rejects.toThrow(/revoked/);
  });

  it("serviceCodeがDB側と食い違う場合はCREDITしない", async () => {
    const serviceCode = "AIART";
    const staleIntegration = await freshIntegration(serviceCode, { perRequestAmountLimit: 1_000_000, dailyAmountLimit: 1_000_000 });
    const tampered = { ...staleIntegration, serviceCode: "SENGOKU_EC" } as ServiceIntegration;

    const { accountId } = await createAccountWithWallet();
    await expect(
      useCase.execute({
        serviceIntegration: tampered,
        oveAccountId: accountId,
        amount: 100n,
        transactionType: "AIART_ATTENDANCE",
        idempotencyKey: `key-stale-servicecode-${generateId()}`,
        displayName: "test",
      }),
    ).rejects.toThrow(/service_code/);
  });
});
