import "reflect-metadata";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { encryptSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { CommonUserLinkingUseCase } from "../accounts/common-user-linking.use-case";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { createTestCommonEventSigningKey, commonEventSignedHeaders, type TestCommonEventSigningKey } from "./test-helpers";

const ENDPOINT = "/api/integrations/events";
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-only-insecure-encryption-key";
const HUB_CONFIG_ID = "default";

/** sengoku-ai.comの共通顧客HUB APIの代わりに、常に同一のcommon_user_idを返すモックサーバー。 */
async function startFixedResponseHub(commonUserId: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, common_user_id: commonUserId, created: false, matched_by: "existing" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

// このファイル内の全describeブロックで1つのNestJSアプリを共有する (`KeyValueStoreModule`の
// Redisクライアントがモジュールスコープのシングルトンであり、`app.close()`のたびに
// `quit()`されるため、複数の独立したアプリインスタンスを同一ファイル内で作成・close
// すると、後続のブロックが「Connection is closed」エラーになる)。
let app: INestApplication;
let key: TestCommonEventSigningKey;

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
  app.use(cookieParser());
  app.useGlobalFilters(new LedgerExceptionFilter());
  await app.init();
  // 100並行リクエストをsupertest経由で送るため、事前に実際のポートでlistenしておく
  // (listen前のhttp.Serverに対しては、supertestがリクエストのたびに内部的な
  // listen/closeを行い、高並行数ではECONNRESETを起こすことがある)。
  await app.listen(0);
  key = await createTestCommonEventSigningKey();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

beforeEach(() => {
  process.env.ENABLE_COMMON_EVENT_INBOX = "true";
});

async function createAccount(): Promise<string> {
  const accountId = generateId();
  await prisma.oveAccount.create({
    data: { id: accountId, accountCode: `OVE-ACC-TEST-${generateId()}`, status: "ACTIVE" },
  });
  return accountId;
}

function resolvedEventBody(commonUserId: string, sourceUserId: string) {
  return {
    event_id: `evt_${generateId()}`,
    event_type: "common_user.resolved",
    event_version: "1.0",
    occurred_at: new Date().toISOString(),
    source_system_key: "agency-system",
    common_user_id: commonUserId,
    source_user_id: sourceUserId,
  };
}

/**
 * 追加整合性対策指示書 P0-1 回帰: 異なる複数アカウントへ同じcommon_user_idを
 * 同時設定しようとしても、実際に設定されるのは1アカウントだけであることを検証する
 * (`CommonUserLinkingUseCase`が`AccountRepository.lockByCommonUserId`
 * (PostgreSQL advisory lock) でcommon_user_id単位の書き込みを直列化する)。
 */
describe("common_user_idの同時設定競合 (追加整合性対策 P0-1回帰)", () => {
  it("100件の異なるアカウントへ同一common_user_idを同時設定しても、1アカウントだけに保存される", async () => {
    const commonUserId = `cu_concurrent_${generateId()}`;
    const concurrency = 100;
    const accountIds = await Promise.all(Array.from({ length: concurrency }, () => createAccount()));

    const results = await Promise.all(
      accountIds.map((accountId) => {
        const body = resolvedEventBody(commonUserId, accountId);
        const headers = commonEventSignedHeaders(key, body);
        return request(app.getHttpServer()).post(ENDPOINT).set(headers).send(body).expect(201);
      }),
    );

    const actions = results.map((r) => r.body.result.action as string);
    expect(actions.filter((a) => a === "linked")).toHaveLength(1);
    expect(actions.filter((a) => a === "conflict_ignored")).toHaveLength(concurrency - 1);

    const linkedAccounts = await prisma.oveAccount.findMany({ where: { commonUserId } });
    expect(linkedAccounts).toHaveLength(1);
    expect(accountIds).toContain(linkedAccounts[0]!.id);

    const conflictLogs = await prisma.auditLog.count({
      where: { actionType: "COMMON_USER_RESOLVED_CONFLICT", afterData: { path: ["rejectedCommonUserId"], equals: commonUserId } },
    });
    expect(conflictLogs).toBe(concurrency - 1);
  });

  it("既存同一リンク(既にそのアカウントへ設定済み)への再送はconflictにならずalready_linkedになる", async () => {
    const commonUserId = `cu_already_${generateId()}`;
    const accountId = await createAccount();
    await prisma.oveAccount.update({ where: { id: accountId }, data: { commonUserId, commonUserLinkedAt: new Date() } });

    const body = resolvedEventBody(commonUserId, accountId);
    const headers = commonEventSignedHeaders(key, body);
    const res = await request(app.getHttpServer()).post(ENDPOINT).set(headers).send(body).expect(201);
    expect(res.body.result.action).toBe("already_linked");
  });

  it("既存の別アカウントへのリンクに対する競合リクエストが並行しても、既存の値は変更されない", async () => {
    const commonUserId = `cu_existing_${generateId()}`;
    const existingAccountId = await createAccount();
    await prisma.oveAccount.update({
      where: { id: existingAccountId },
      data: { commonUserId, commonUserLinkedAt: new Date() },
    });

    // グローバルレート制限 (ThrottlerModule, 60秒あたり120リクエスト/IP) を
    // このファイル内の他テスト (100並行) と合算しても超えないよう、小さめの並行数にする。
    const concurrency = 10;
    const challengerIds = await Promise.all(Array.from({ length: concurrency }, () => createAccount()));
    const results = await Promise.all(
      challengerIds.map((accountId) => {
        const body = resolvedEventBody(commonUserId, accountId);
        const headers = commonEventSignedHeaders(key, body);
        return request(app.getHttpServer()).post(ENDPOINT).set(headers).send(body).expect(201);
      }),
    );

    expect(results.every((r) => r.body.result.action === "conflict_ignored")).toBe(true);

    const linkedAccounts = await prisma.oveAccount.findMany({ where: { commonUserId } });
    expect(linkedAccounts).toHaveLength(1);
    expect(linkedAccounts[0]!.id).toBe(existingAccountId);
  });

  it("Common Event経由とHUB resolve経由が同時に同一common_user_idを設定しようとしても、1アカウントだけに保存される", async () => {
    const commonUserId = `cu_dual_path_${generateId()}`;
    const hub = await startFixedResponseHub(commonUserId);
    try {
      await prisma.commonUserHubConfig.upsert({
        where: { id: HUB_CONFIG_ID },
        create: {
          id: HUB_CONFIG_ID,
          baseUrl: hub.url,
          systemKey: "ove-wallet",
          apiKeyEncrypted: encryptSecret("test-outbound-key", ENCRYPTION_KEY),
          apiKeyPreview: "****-key",
        },
        update: { baseUrl: hub.url, apiKeyEncrypted: encryptSecret("test-outbound-key", ENCRYPTION_KEY) },
      });
      process.env.ENABLE_PLATFORM_USER_ID = "true";

      // Common Event経由: 既存の別アカウントへ、同じcommon_user_idを設定しようとする。
      const eventTargetAccountId = await createAccount();
      const body = resolvedEventBody(commonUserId, eventTargetAccountId);
      const headers = commonEventSignedHeaders(key, body);

      // HUB resolve経由: 新規LINEログインで、HUBが同じcommon_user_idを返す。
      const idToken = `mock.${generateId()}`;

      const [eventRes, loginRes] = await Promise.all([
        request(app.getHttpServer()).post(ENDPOINT).set(headers).send(body).expect(201),
        request(app.getHttpServer()).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201),
      ]);

      const loginAccountId = loginRes.body.ove_account_id as string;
      const linkedAccounts = await prisma.oveAccount.findMany({ where: { commonUserId } });
      expect(linkedAccounts).toHaveLength(1);
      expect([eventTargetAccountId, loginAccountId]).toContain(linkedAccounts[0]!.id);

      // どちらか一方だけが実際にリンクされている (event側がlinked かつ HUB側がconflict、もしくはその逆)。
      const eventLinked = eventRes.body.result.action === "linked";
      const loginAccount = await prisma.oveAccount.findUniqueOrThrow({ where: { id: loginAccountId } });
      const loginLinked = loginAccount.commonUserId === commonUserId;
      expect(eventLinked).toBe(!loginLinked);
    } finally {
      delete process.env.ENABLE_PLATFORM_USER_ID;
      await prisma.commonUserHubConfig.deleteMany({ where: { id: HUB_CONFIG_ID } });
      await hub.close();
    }
  });
});

function mergedEventBody(newCommonUserId: string, previousCommonUserId: string) {
  return {
    event_id: `evt_${generateId()}`,
    event_type: "common_user.merged",
    event_version: "1.0",
    occurred_at: new Date().toISOString(),
    source_system_key: "agency-system",
    common_user_id: newCommonUserId,
    previous_common_user_id: previousCommonUserId,
  };
}

/**
 * PR #1最終修正: `common_user.merged`受信時、旧common_user_idを持つローカルアカウントが
 * 1件だけ存在する場合に新IDへ再紐づけできない回帰があった (通常リンク用の`link()`が
 * 「既に別の値が設定済み = 競合」として弾いてしまっていた)。専用の`relinkAfterMerge()`が
 * 正しく再紐づけし、かつ既存の排他制御・監査ログ・デッドロック回避を維持することを検証する。
 */
describe("common_user.merged: 1アカウントのみの再紐づけ (PR #1最終修正回帰)", () => {
  it("旧common_user_idを持つアカウントが1件だけの場合、新IDへ再紐づけされる", async () => {
    const previousCommonUserId = `cu_prev_${generateId()}`;
    const newCommonUserId = `cu_new_${generateId()}`;
    const accountId = await createAccount();
    await prisma.oveAccount.update({ where: { id: accountId }, data: { commonUserId: previousCommonUserId } });

    const body = mergedEventBody(newCommonUserId, previousCommonUserId);
    const headers = commonEventSignedHeaders(key, body);
    const res = await request(app.getHttpServer()).post(ENDPOINT).set(headers).send(body).expect(201);

    expect(res.body.result.action).toBe("relinked");
    expect(res.body.result.ove_account_id).toBe(accountId);

    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.commonUserId).toBe(newCommonUserId);

    const auditLog = await prisma.auditLog.findFirst({
      where: { actionType: "COMMON_USER_MERGED_RELINKED", targetId: accountId },
      orderBy: { createdAt: "desc" },
    });
    expect(auditLog).not.toBeNull();
    expect((auditLog!.beforeData as Record<string, unknown>).commonUserId).toBe(previousCommonUserId);
    expect((auditLog!.afterData as Record<string, unknown>).commonUserId).toBe(newCommonUserId);
  });

  it("同一アカウントが既に新IDへ移行済みの状態でmergeイベントが再送されても冪等 (二重AuditLogを作らない)", async () => {
    const previousCommonUserId = `cu_prev_${generateId()}`;
    const newCommonUserId = `cu_new_${generateId()}`;
    const accountId = await createAccount();
    await prisma.oveAccount.update({ where: { id: accountId }, data: { commonUserId: previousCommonUserId } });

    const firstBody = mergedEventBody(newCommonUserId, previousCommonUserId);
    const firstHeaders = commonEventSignedHeaders(key, firstBody);
    await request(app.getHttpServer()).post(ENDPOINT).set(firstHeaders).send(firstBody).expect(201);

    // 再送 (event_idは異なるが内容は同じ、Inbox側のevent_id重複排除とは別に
    // UseCase自体の冪等性を検証する)。
    const resendBody = mergedEventBody(newCommonUserId, previousCommonUserId);
    const resendHeaders = commonEventSignedHeaders(key, resendBody);
    const resendRes = await request(app.getHttpServer()).post(ENDPOINT).set(resendHeaders).send(resendBody).expect(201);
    expect(resendRes.body.result.action).toBe("relinked");

    const relinkLogCount = await prisma.auditLog.count({
      where: { actionType: "COMMON_USER_MERGED_RELINKED", targetId: accountId },
    });
    expect(relinkLogCount).toBe(1);
  });

  it("新common_user_idを別アカウントが既に保持している場合は自動更新せず要レビューにする", async () => {
    const previousCommonUserId = `cu_prev_${generateId()}`;
    const newCommonUserId = `cu_new_${generateId()}`;
    const sourceAccountId = await createAccount();
    await prisma.oveAccount.update({ where: { id: sourceAccountId }, data: { commonUserId: previousCommonUserId } });
    const thirdAccountId = await createAccount();
    await prisma.oveAccount.update({ where: { id: thirdAccountId }, data: { commonUserId: newCommonUserId } });

    // findManyByCommonUserIds([newId, previousId])は2件ヒットしてハンドラの
    // "2件以上"分岐 (承認申請) に入ってしまうため、UseCase自体の競合判定を直接検証する。
    const useCase = app.get(CommonUserLinkingUseCase);
    const result = await useCase.relinkAfterMerge({
      accountId: sourceAccountId,
      expectedPreviousCommonUserId: previousCommonUserId,
      newCommonUserId,
      actorType: "EXTERNAL_SERVICE",
      actorId: "agency-system",
    });
    expect(result.action).toBe("relink_conflict_requires_review");

    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: sourceAccountId } });
    expect(account.commonUserId).toBe(previousCommonUserId);

    const conflictLog = await prisma.auditLog.findFirst({
      where: { actionType: "COMMON_USER_MERGED_RELINK_CONFLICT", targetId: sourceAccountId },
    });
    expect(conflictLog).not.toBeNull();
  });

  it("現在値が期待する旧IDと異なる場合は自動更新しない", async () => {
    const previousCommonUserId = `cu_prev_${generateId()}`;
    const unexpectedCommonUserId = `cu_unexpected_${generateId()}`;
    const newCommonUserId = `cu_new_${generateId()}`;
    const accountId = await createAccount();
    await prisma.oveAccount.update({ where: { id: accountId }, data: { commonUserId: unexpectedCommonUserId } });

    const useCase = app.get(CommonUserLinkingUseCase);
    const result = await useCase.relinkAfterMerge({
      accountId,
      expectedPreviousCommonUserId: previousCommonUserId,
      newCommonUserId,
      actorType: "EXTERNAL_SERVICE",
      actorId: "agency-system",
    });
    expect(result.action).toBe("relink_conflict_requires_review");

    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.commonUserId).toBe(unexpectedCommonUserId);
  });

  it("旧IDと新IDを逆順で同時処理してもデッドロックしない", async () => {
    const idX = `cu_x_${generateId()}`;
    const idY = `cu_y_${generateId()}`;
    const accountA = await createAccount();
    const accountB = await createAccount();
    await prisma.oveAccount.update({ where: { id: accountA }, data: { commonUserId: idX } });
    await prisma.oveAccount.update({ where: { id: accountB }, data: { commonUserId: idY } });

    const useCase = app.get(CommonUserLinkingUseCase);
    // A: X→Y、B: Y→X を同時に処理する。ロックキーのソート順が固定されていれば
    // (呼び出し順に関わらず常に[idX, idY]の順) デッドロックしない。
    const [resultA, resultB] = await Promise.all([
      useCase.relinkAfterMerge({
        accountId: accountA,
        expectedPreviousCommonUserId: idX,
        newCommonUserId: idY,
        actorType: "EXTERNAL_SERVICE",
        actorId: "agency-system",
      }),
      useCase.relinkAfterMerge({
        accountId: accountB,
        expectedPreviousCommonUserId: idY,
        newCommonUserId: idX,
        actorType: "EXTERNAL_SERVICE",
        actorId: "agency-system",
      }),
    ]);

    // 互いに相手が現在保持しているIDを奪い合う形になるため、両方とも競合として
    // 検出され、どちらの値も変更されない (安全側に倒れる)。ここで検証したいのは
    // デッドロックで例外にならず両方とも完了することと、データが不整合にならないこと。
    expect(resultA.action).toBe("relink_conflict_requires_review");
    expect(resultB.action).toBe("relink_conflict_requires_review");

    const finalA = await prisma.oveAccount.findUniqueOrThrow({ where: { id: accountA } });
    const finalB = await prisma.oveAccount.findUniqueOrThrow({ where: { id: accountB } });
    expect(finalA.commonUserId).toBe(idX);
    expect(finalB.commonUserId).toBe(idY);
  });
});
