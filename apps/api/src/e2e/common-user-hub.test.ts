import "reflect-metadata";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { encryptSecret, hashSecret } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { AccountsService } from "../accounts/accounts.service";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-only-insecure-encryption-key";
const CONFIG_ID = "default";

interface MockHubRequest {
  path: string;
  body: Record<string, unknown>;
}

interface MockHubServer {
  url: string;
  requests: MockHubRequest[];
  close: () => Promise<void>;
}

/** sengoku-ai.comの共通顧客HUB API (外部開発者向け連携ガイド9章) の代わりに立てるテスト用モックサーバー。 */
async function startMockHub(
  responder: (path: string, body: Record<string, unknown>) => { status: number; body: unknown },
): Promise<MockHubServer> {
  const requests: MockHubRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      const path = req.url ?? "";
      requests.push({ path, body });
      const { status, body: resBody } = responder(path, body);
      res.statusCode = status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(resBody));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** 新規登録時にログインさせ、作成されたove_account_idを返す。identityは毎回ユニーク。 */
async function registerViaLineLogin(server: Parameters<typeof request>[0]): Promise<string> {
  const idToken = `mock.${generateId()}`;
  const res = await request(server).post("/api/v1/auth/line/login").send({ idToken, termsAccepted: true }).expect(201);
  return res.body.ove_account_id as string;
}

/** AdminCommonUserHubServiceが書き込むのと同じ形で common_user_hub_config (シングルトン行) を用意する。 */
async function seedConfig(params: { baseUrl: string; apiKey?: string | null }): Promise<void> {
  await prisma.commonUserHubConfig.upsert({
    where: { id: CONFIG_ID },
    create: {
      id: CONFIG_ID,
      baseUrl: params.baseUrl,
      systemKey: "ove-wallet",
      apiKeyEncrypted: params.apiKey ? encryptSecret(params.apiKey, ENCRYPTION_KEY) : null,
      apiKeyPreview: params.apiKey ? `****${params.apiKey.slice(-4)}` : null,
    },
    update: {
      baseUrl: params.baseUrl,
      apiKeyEncrypted: params.apiKey ? encryptSecret(params.apiKey, ENCRYPTION_KEY) : null,
      apiKeyPreview: params.apiKey ? `****${params.apiKey.slice(-4)}` : null,
    },
  });
}

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

describe("共通顧客HUBへのcommon_user_id解決 (外部開発者向け連携ガイド9章)", () => {
  let hub: MockHubServer | undefined;

  afterEach(async () => {
    await hub?.close();
    hub = undefined;
    delete process.env.ENABLE_PLATFORM_USER_ID;
    await prisma.commonUserHubConfig.deleteMany({ where: { id: CONFIG_ID } });
  });

  it("resolves and stores common_user_id on new registration when the feature flag and config are set", async () => {
    hub = await startMockHub((path) => {
      if (path.startsWith("/api/common-users/resolve")) {
        return { status: 200, body: { ok: true, common_user_id: "cu_test_resolved", created: true, matched_by: "created" } };
      }
      return { status: 404, body: { ok: false } };
    });
    await seedConfig({ baseUrl: hub.url, apiKey: "test-outbound-key" });
    process.env.ENABLE_PLATFORM_USER_ID = "true";

    const oveAccountId = await registerViaLineLogin(app.getHttpServer());

    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: oveAccountId } });
    expect(account.commonUserId).toBe("cu_test_resolved");
    expect(account.commonUserLinkedAt).not.toBeNull();

    const resolveRequests = hub.requests.filter((r) => r.path.startsWith("/api/common-users/resolve"));
    expect(resolveRequests).toHaveLength(1);
    expect(resolveRequests[0]!.body).toMatchObject({
      system_key: "ove-wallet",
      external_user_id: oveAccountId,
      create_if_missing: true,
    });
  });

  it("does not call the hub and leaves common_user_id null when ENABLE_PLATFORM_USER_ID is disabled (default)", async () => {
    hub = await startMockHub(() => ({
      status: 200,
      body: { ok: true, common_user_id: "should-not-be-used" },
    }));
    await seedConfig({ baseUrl: hub.url, apiKey: "test-outbound-key" });
    // ENABLE_PLATFORM_USER_ID は未設定のまま (既定false)。設定は完全に揃っていても呼ばれない。

    const oveAccountId = await registerViaLineLogin(app.getHttpServer());

    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: oveAccountId } });
    expect(account.commonUserId).toBeNull();
    expect(hub.requests).toHaveLength(0);
  });

  it("does not call the hub when no API key is configured, even if the flag is enabled", async () => {
    hub = await startMockHub(() => ({ status: 200, body: { ok: true, common_user_id: "should-not-be-used" } }));
    await seedConfig({ baseUrl: hub.url, apiKey: null });
    process.env.ENABLE_PLATFORM_USER_ID = "true";

    const oveAccountId = await registerViaLineLogin(app.getHttpServer());

    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: oveAccountId } });
    expect(account.commonUserId).toBeNull();
    expect(hub.requests).toHaveLength(0);
  });

  it("does not block registration when the hub call fails", async () => {
    hub = await startMockHub(() => ({ status: 500, body: { ok: false } }));
    await seedConfig({ baseUrl: hub.url, apiKey: "test-outbound-key" });
    process.env.ENABLE_PLATFORM_USER_ID = "true";

    const oveAccountId = await registerViaLineLogin(app.getHttpServer());

    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: oveAccountId } });
    expect(account.status).toBe("ACTIVE");
    expect(account.commonUserId).toBeNull();
  });

  it("does not block registration when the hub host is unreachable", async () => {
    await seedConfig({ baseUrl: "http://127.0.0.1:1", apiKey: "test-outbound-key" }); // 即座に接続拒否されるポート
    process.env.ENABLE_PLATFORM_USER_ID = "true";

    const oveAccountId = await registerViaLineLogin(app.getHttpServer());

    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: oveAccountId } });
    expect(account.status).toBe("ACTIVE");
    expect(account.commonUserId).toBeNull();
  });

  it("skips the hub call when skipCommonUserHubLink is set (既存ユーザー一括移行向け)", async () => {
    hub = await startMockHub(() => ({
      status: 200,
      body: { ok: true, common_user_id: "should-not-be-used-by-bulk-migration" },
    }));
    await seedConfig({ baseUrl: hub.url, apiKey: "test-outbound-key" });
    process.env.ENABLE_PLATFORM_USER_ID = "true";

    const accounts = app.get(AccountsService);
    const account = await accounts.findOrCreateByIdentity({
      identityType: "LEGACY_SYSTEM",
      provider: "LEGACY_SYSTEM",
      providerSubject: `legacy-${generateId()}`,
      termsAccepted: true,
      skipCommonUserHubLink: true,
    });

    expect(hub.requests).toHaveLength(0);
    const stored = await prisma.oveAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(stored.commonUserId).toBeNull();
  });
});

describe("管理画面: 共通顧客HUB送信設定 (GET/POST /api/v1/admin/common-user-hub-config)", () => {
  let adminCookie: string[];

  beforeAll(async () => {
    const email = `e2e-hub-config-admin-${generateId()}@ovewallet.local`;
    const password = "e2e-test-password-123";
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: `OVE-ADM-${generateId()}`,
        email,
        passwordHash: hashSecret(password),
        role: "SUPER_ADMIN",
        displayName: "E2E Hub Config Admin",
      },
    });
    const loginRes = await request(app.getHttpServer()).post("/api/v1/admin/login").send({ email, password }).expect(201);
    adminCookie = loginRes.headers["set-cookie"] as unknown as string[];
  });

  afterEach(async () => {
    await prisma.commonUserHubConfig.deleteMany({ where: { id: CONFIG_ID } });
  });

  it("rejects unauthenticated access", async () => {
    await request(app.getHttpServer()).get("/api/v1/admin/common-user-hub-config").expect(401);
  });

  it("returns defaults with apiKeySet=false before any config is saved", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/admin/common-user-hub-config")
      .set("Cookie", adminCookie)
      .expect(200);

    expect(res.body).toMatchObject({
      baseUrl: "https://sengoku-ai.com",
      systemKey: "ove-wallet",
      apiKeySet: false,
      apiKeyPreview: null,
    });
  });

  it("saves baseUrl/systemKey/apiKey, masks the key in the response, and records an audit log", async () => {
    const putRes = await request(app.getHttpServer())
      .post("/api/v1/admin/common-user-hub-config")
      .set("Cookie", adminCookie)
      .send({ baseUrl: "https://sengoku-ai.example", systemKey: "sen-no-kuni-wallet", apiKey: "real-secret-key-abcd", reason: "初回設定" })
      .expect(201);

    expect(putRes.body).toMatchObject({
      baseUrl: "https://sengoku-ai.example",
      systemKey: "sen-no-kuni-wallet",
      apiKeySet: true,
      apiKeyPreview: expect.stringMatching(/^\*+abcd$/),
    });
    // レスポンスに生のAPIキーが含まれていないこと
    expect(JSON.stringify(putRes.body)).not.toContain("real-secret-key-abcd");

    const stored = await prisma.commonUserHubConfig.findUniqueOrThrow({ where: { id: CONFIG_ID } });
    expect(stored.apiKeyEncrypted).not.toBeNull();
    expect(stored.apiKeyEncrypted).not.toContain("real-secret-key-abcd");

    const getRes = await request(app.getHttpServer())
      .get("/api/v1/admin/common-user-hub-config")
      .set("Cookie", adminCookie)
      .expect(200);
    expect(getRes.body).toMatchObject({
      baseUrl: "https://sengoku-ai.example",
      apiKeySet: true,
      apiKeyPreview: expect.stringMatching(/^\*+abcd$/),
    });

    // targetId は固定のシングルトン行なので、他テスト由来の履歴と混ざる可能性がある。
    // 直近の1件がこの更新を反映していることだけを確認する。
    const [latestLog] = await prisma.auditLog.findMany({
      where: { targetType: "common_user_hub_config", targetId: CONFIG_ID },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(latestLog?.actionType).toBe("COMMON_USER_HUB_CONFIG_UPDATED");
    expect(latestLog?.reason).toBe("初回設定");
  });

  it("keeps the existing API key when updating only baseUrl", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/admin/common-user-hub-config")
      .set("Cookie", adminCookie)
      .send({ apiKey: "keep-me-secret-wxyz", reason: "初期鍵設定" })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post("/api/v1/admin/common-user-hub-config")
      .set("Cookie", adminCookie)
      .send({ baseUrl: "https://sengoku-ai.example2", reason: "URLだけ変更" })
      .expect(201);

    expect(res.body).toMatchObject({
      baseUrl: "https://sengoku-ai.example2",
      apiKeySet: true,
      apiKeyPreview: expect.stringMatching(/^\*+wxyz$/),
    });
  });

  it("rejects update without a reason", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/admin/common-user-hub-config")
      .set("Cookie", adminCookie)
      .send({ baseUrl: "https://sengoku-ai.example" })
      .expect(400);
  });
});
