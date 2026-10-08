import "reflect-metadata";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { encryptSecret, hashSecret } from "@ove/auth";
import { prisma, generateId, nextDisplayCode, ACCOUNT_CODE_COUNTER } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-only-insecure-encryption-key";
const CONFIG_ID = "default";

interface MockHub {
  url: string;
  requestCount: number;
  close: () => Promise<void>;
}

/** 共通顧客HUB (sengoku-ai.com) の代わりに立てるテスト用モックサーバー。 */
async function startMockHub(responder: () => { status: number; body: unknown }): Promise<MockHub> {
  const state = { requestCount: 0 };
  const server = http.createServer((req, res) => {
    req.on("data", () => {});
    req.on("end", () => {
      state.requestCount += 1;
      const { status, body } = responder();
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    get requestCount() {
      return state.requestCount;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function seedHubConfig(params: { baseUrl: string; apiKey: string | null }): Promise<void> {
  const encrypted = params.apiKey ? encryptSecret(params.apiKey, ENCRYPTION_KEY) : null;
  await prisma.commonUserHubConfig.upsert({
    where: { id: CONFIG_ID },
    create: {
      id: CONFIG_ID,
      baseUrl: params.baseUrl,
      systemKey: "ove-wallet",
      apiKeyEncrypted: encrypted,
      apiKeyPreview: params.apiKey ? `****${params.apiKey.slice(-4)}` : null,
    },
    update: {
      baseUrl: params.baseUrl,
      apiKeyEncrypted: encrypted,
      apiKeyPreview: params.apiKey ? `****${params.apiKey.slice(-4)}` : null,
    },
  });
}

/**
 * 管理画面からの共通ID再解決 (バックフィル)。
 *
 * common_user_idは新規登録時の自動解決か共通イベント受信でしか入らず、
 * 登録時の解決は共通顧客HUBが未設定・誤設定でも登録を成功させるベストエフォート。
 * そのため設定が揃っていない期間に作られたアカウントは空のまま固定され、
 * デジタル会員証の付与 (`entitlement.granted`) もカード受取も通らなくなっていた。
 * ここでは「どの結果がどう返るか」を結果の種類ごとに固定する。
 */
describe("管理画面からの共通ID再解決", () => {
  let app: INestApplication;
  let cookie: string[];
  let hub: MockHub | undefined;

  async function createAccount(commonUserId?: string): Promise<string> {
    const id = generateId();
    await prisma.oveAccount.create({
      data: {
        id,
        accountCode: await nextDisplayCode(prisma, ACCOUNT_CODE_COUNTER, "OVE-ACC"),
        status: "ACTIVE",
        primaryEmail: `resolve-target-${id}@ovewallet.local`,
        commonUserId,
        commonUserLinkedAt: commonUserId ? new Date() : null,
      },
    });
    return id;
  }

  async function resolve(accountId: string, expectedStatus = 201) {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/admin/accounts/${accountId}/resolve-common-user`)
      .set("Cookie", cookie)
      .send({ reason: "E2E: カード受取が共通ID未解決で止まるため" })
      .expect(expectedStatus);
    return res.body as { outcome: string; message: string; commonUserId: string | null };
  }

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();

    const adminEmail = `common-user-resolve-admin-${generateId()}@ovewallet.local`;
    const password = "common-user-resolve-e2e-password";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-CUR-${generateId()}`,
        email: adminEmail,
        passwordHash: hashSecret(password),
        role: "SUPER_ADMIN",
        displayName: "Common User Resolve E2E Admin",
      },
    });
    const login = await request(app.getHttpServer())
      .post("/api/v1/admin/login")
      .send({ email: adminEmail, password })
      .expect(201);
    cookie = login.headers["set-cookie"] as unknown as string[];
  });

  afterEach(async () => {
    await hub?.close();
    hub = undefined;
    delete process.env.ENABLE_PLATFORM_USER_ID;
    await prisma.commonUserHubConfig.deleteMany({ where: { id: CONFIG_ID } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("未解決のアカウントに共通IDを紐付け、監査ログを残す", async () => {
    const commonUserId = `cu_test_backfill_${generateId()}`;
    hub = await startMockHub(() => ({
      status: 200,
      body: { ok: true, common_user_id: commonUserId, created: false, matched_by: "email" },
    }));
    await seedHubConfig({ baseUrl: hub.url, apiKey: "test-outbound-key" });
    process.env.ENABLE_PLATFORM_USER_ID = "true";

    const accountId = await createAccount();
    const body = await resolve(accountId);

    expect(body.outcome).toBe("linked");
    expect(body.commonUserId).toBe(commonUserId);

    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.commonUserId).toBe(commonUserId);
    expect(account.commonUserLinkedAt).not.toBeNull();

    const logs = await prisma.auditLog.findMany({
      where: { targetType: "ove_account", targetId: accountId, actionType: "COMMON_USER_RESOLVE_REQUESTED" },
    });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.result).toBe("SUCCESS");
    expect(logs[0]!.beforeData).toEqual({ commonUserId: null });
    expect(logs[0]!.afterData).toEqual({ outcome: "linked", commonUserId });
  });

  it("既に同じ共通IDが紐付いていれば already_linked を返し、再実行しても壊れない (冪等)", async () => {
    const commonUserId = `cu_test_idempotent_${generateId()}`;
    hub = await startMockHub(() => ({
      status: 200,
      body: { ok: true, common_user_id: commonUserId, created: false, matched_by: "email" },
    }));
    await seedHubConfig({ baseUrl: hub.url, apiKey: "test-outbound-key" });
    process.env.ENABLE_PLATFORM_USER_ID = "true";

    const accountId = await createAccount(commonUserId);
    const body = await resolve(accountId);

    expect(body.outcome).toBe("already_linked");
    expect(body.commonUserId).toBe(commonUserId);
  });

  it("別アカウントに紐付いている共通IDは自動設定せず conflict を返す", async () => {
    const commonUserId = `cu_test_conflict_${generateId()}`;
    await createAccount(commonUserId);

    hub = await startMockHub(() => ({
      status: 200,
      body: { ok: true, common_user_id: commonUserId, created: false, matched_by: "email" },
    }));
    await seedHubConfig({ baseUrl: hub.url, apiKey: "test-outbound-key" });
    process.env.ENABLE_PLATFORM_USER_ID = "true";

    const accountId = await createAccount();
    const body = await resolve(accountId);

    expect(body.outcome).toBe("conflict");
    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.commonUserId).toBeNull();

    const logs = await prisma.auditLog.findMany({
      where: { targetType: "ove_account", targetId: accountId, actionType: "COMMON_USER_RESOLVE_REQUESTED" },
    });
    expect(logs[0]!.result).toBe("FAILURE");
  });

  it("Feature Flag OFF・APIキー未設定ではHUBを呼ばず not_configured を返す", async () => {
    hub = await startMockHub(() => ({ status: 200, body: { ok: true, common_user_id: "should-not-be-used" } }));
    await seedHubConfig({ baseUrl: hub.url, apiKey: "test-outbound-key" });
    // ENABLE_PLATFORM_USER_ID は未設定のまま (既定false)。

    const accountId = await createAccount();
    const body = await resolve(accountId);

    expect(body.outcome).toBe("not_configured");
    expect(hub.requestCount).toBe(0);
  });

  it("HUBがエラーを返したときは hub_unavailable を返し、not_configured と区別する", async () => {
    hub = await startMockHub(() => ({ status: 500, body: { ok: false } }));
    await seedHubConfig({ baseUrl: hub.url, apiKey: "test-outbound-key" });
    process.env.ENABLE_PLATFORM_USER_ID = "true";

    const accountId = await createAccount();
    const body = await resolve(accountId);

    expect(body.outcome).toBe("hub_unavailable");
    expect(hub.requestCount).toBeGreaterThan(0);
  });

  it("理由が空のリクエストは拒否する (監査ログに残す理由を必須にする)", async () => {
    const accountId = await createAccount();
    await request(app.getHttpServer())
      .post(`/api/v1/admin/accounts/${accountId}/resolve-common-user`)
      .set("Cookie", cookie)
      .send({ reason: "" })
      .expect(400);
  });

  it("存在しないアカウントは404", async () => {
    await resolve(generateId(), 404);
  });
});
