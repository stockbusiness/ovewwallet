import "reflect-metadata";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { AccountsService } from "../accounts/accounts.service";

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

describe("共通顧客HUBへのcommon_user_id解決 (外部開発者向け連携ガイド9章)", () => {
  let app: INestApplication;
  let hub: MockHubServer | undefined;

  beforeAll(async () => {
    app = await NestFactory.create(AppModule, { logger: false });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await hub?.close();
    hub = undefined;
    delete process.env.ENABLE_PLATFORM_USER_ID;
    delete process.env.SENGOKU_AI_COMMON_USER_HUB_URL;
    delete process.env.SENGOKU_AI_OUTBOUND_API_KEY;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("resolves and stores common_user_id on new registration when the feature flag and API key are set", async () => {
    hub = await startMockHub((path) => {
      if (path.startsWith("/api/common-users/resolve")) {
        return { status: 200, body: { ok: true, common_user_id: "cu_test_resolved", created: true, matched_by: "created" } };
      }
      return { status: 404, body: { ok: false } };
    });
    process.env.ENABLE_PLATFORM_USER_ID = "true";
    process.env.SENGOKU_AI_COMMON_USER_HUB_URL = hub.url;
    process.env.SENGOKU_AI_OUTBOUND_API_KEY = "test-outbound-key";

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
    process.env.SENGOKU_AI_COMMON_USER_HUB_URL = hub.url;
    process.env.SENGOKU_AI_OUTBOUND_API_KEY = "test-outbound-key";
    // ENABLE_PLATFORM_USER_ID は未設定のまま (既定false)

    const oveAccountId = await registerViaLineLogin(app.getHttpServer());

    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: oveAccountId } });
    expect(account.commonUserId).toBeNull();
    expect(hub.requests).toHaveLength(0);
  });

  it("does not call the hub when the outbound API key is unset, even if the flag is enabled", async () => {
    hub = await startMockHub(() => ({ status: 200, body: { ok: true, common_user_id: "should-not-be-used" } }));
    process.env.ENABLE_PLATFORM_USER_ID = "true";
    process.env.SENGOKU_AI_COMMON_USER_HUB_URL = hub.url;
    // SENGOKU_AI_OUTBOUND_API_KEY は未設定のまま

    const oveAccountId = await registerViaLineLogin(app.getHttpServer());

    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: oveAccountId } });
    expect(account.commonUserId).toBeNull();
    expect(hub.requests).toHaveLength(0);
  });

  it("does not block registration when the hub call fails", async () => {
    hub = await startMockHub(() => ({ status: 500, body: { ok: false } }));
    process.env.ENABLE_PLATFORM_USER_ID = "true";
    process.env.SENGOKU_AI_COMMON_USER_HUB_URL = hub.url;
    process.env.SENGOKU_AI_OUTBOUND_API_KEY = "test-outbound-key";

    const oveAccountId = await registerViaLineLogin(app.getHttpServer());

    const account = await prisma.oveAccount.findUniqueOrThrow({ where: { id: oveAccountId } });
    expect(account.status).toBe("ACTIVE");
    expect(account.commonUserId).toBeNull();
  });

  it("does not block registration when the hub host is unreachable", async () => {
    process.env.ENABLE_PLATFORM_USER_ID = "true";
    process.env.SENGOKU_AI_COMMON_USER_HUB_URL = "http://127.0.0.1:1"; // 即座に接続拒否されるポート
    process.env.SENGOKU_AI_OUTBOUND_API_KEY = "test-outbound-key";

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
    process.env.ENABLE_PLATFORM_USER_ID = "true";
    process.env.SENGOKU_AI_COMMON_USER_HUB_URL = hub.url;
    process.env.SENGOKU_AI_OUTBOUND_API_KEY = "test-outbound-key";

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
