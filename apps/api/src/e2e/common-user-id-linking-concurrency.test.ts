import "reflect-metadata";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { encryptSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
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

/**
 * 追加整合性対策指示書 P0-1 回帰: 異なる複数アカウントへ同じcommon_user_idを
 * 同時設定しようとしても、実際に設定されるのは1アカウントだけであることを検証する
 * (`CommonUserLinkingUseCase`が`AccountRepository.lockByCommonUserId`
 * (PostgreSQL advisory lock) でcommon_user_id単位の書き込みを直列化する)。
 */
describe("common_user_idの同時設定競合 (追加整合性対策 P0-1回帰)", () => {
  let app: INestApplication;
  let key: TestCommonEventSigningKey;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
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
