import "reflect-metadata";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import request from "supertest";
import { prisma, generateId } from "@ove/database";
import { encryptSecret, decryptSecret } from "@ove/auth";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { REFERRAL_SESSION_COOKIE_NAME } from "../referrals/referrals.controller";

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

/** 代理店システムの紹介関係API・共通顧客HUB APIの代わりに立てるテスト用モックサーバー。 */
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

function extractCookie(setCookieHeader: string[] | undefined, name: string): string | undefined {
  const raw = setCookieHeader?.find((c) => c.startsWith(`${name}=`));
  if (!raw) return undefined;
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1];
}

/**
 * 紹介Phase 2 (共通実装契約5章): /invite/{token}受付 (capture) → LINEログイン →
 * common_user_id解決 → 代理店システムconfirm → 登録特典3,000 OVEの確定付与までの
 * 一連の流れを、代理店システムのモックサーバーに対して検証する。
 */
describe("紹介Phase 2: capture → common_user resolve → confirm → 特典確定", () => {
  let app: INestApplication;
  let hub: MockHubServer;

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

  beforeEach(() => {
    process.env.ENABLE_WALLET_REFERRAL_TOKEN = "true";
    process.env.ENABLE_AGENCY_REFERRAL_SYNC = "true";
    process.env.ENABLE_PLATFORM_USER_ID = "true";
  });

  afterEach(async () => {
    await hub?.close();
    delete process.env.ENABLE_WALLET_REFERRAL_TOKEN;
    delete process.env.ENABLE_AGENCY_REFERRAL_SYNC;
    delete process.env.ENABLE_PLATFORM_USER_ID;
    await prisma.commonUserHubConfig.deleteMany({ where: { id: CONFIG_ID } });
  });

  it("captures canonical referral info, then confirms and credits 3000 OVE right after common_user resolve", async () => {
    // 実際のsession key/tokenはリクエストごとに一意な値が発行される。他のテスト実行
    // (再実行・並行実行) と衝突しないよう、ここでも都度ユニークな値を使う
    // (`referral_session_key`にDB一意制約は無いため、固定値だと過去の確定済み行を
    // 誤って再利用してしまう)。
    const sessionKey = `rs_test_phase2_${generateId()}`;
    const canonicalToken = `rt_test_phase2_${generateId()}`;
    let capturedCommonUserId: string | undefined;

    hub = await startMockHub((path, body) => {
      if (path.startsWith("/api/referrals/capture")) {
        return {
          status: 200,
          body: {
            referral_session_key: sessionKey,
            canonical_referral_token: canonicalToken,
            agency_id: "AGENT-CODE-001",
            project_id: "proj_1",
            status: "captured",
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          },
        };
      }
      if (path.startsWith("/api/common-users/resolve")) {
        capturedCommonUserId = `cu_test_${generateId()}`;
        return { status: 200, body: { ok: true, common_user_id: capturedCommonUserId, created: true, matched_by: "created" } };
      }
      if (path.startsWith("/api/referrals/confirm")) {
        return { status: 200, body: { status: "confirmed", common_user_id: body.common_user_id } };
      }
      return { status: 404, body: { ok: false } };
    });
    await seedConfig({ baseUrl: hub.url, apiKey: "test-outbound-key" });

    const rawToken = `referral-phase2-${generateId()}`;
    const captureRes = await request(app.getHttpServer()).get(`/api/v1/referrals/capture?token=${rawToken}`).expect(302);
    const cookieValue = extractCookie(captureRes.headers["set-cookie"] as unknown as string[], REFERRAL_SESSION_COOKIE_NAME);
    expect(cookieValue).toBeDefined();

    const referralAfterCapture = await prisma.walletReferral.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    expect(referralAfterCapture.agencyId).toBe("AGENT-CODE-001");
    expect(referralAfterCapture.referralSessionKey).toBe(sessionKey);
    expect(referralAfterCapture.canonicalReferralTokenEncrypted).not.toBeNull();
    expect(decryptSecret(referralAfterCapture.canonicalReferralTokenEncrypted!, ENCRYPTION_KEY)).toBe(canonicalToken);

    const lineUserId = `e2e-phase2-${generateId()}`;
    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/auth/line/login")
      .set("Cookie", [`${REFERRAL_SESSION_COOKIE_NAME}=${cookieValue}`])
      .send({ idToken: `mock.${lineUserId}`, termsAccepted: true })
      .expect(201);
    const oveAccountId = loginRes.body.ove_account_id as string;

    const confirmRequests = hub.requests.filter((r) => r.path.startsWith("/api/referrals/confirm"));
    expect(confirmRequests).toHaveLength(1);
    expect(confirmRequests[0]!.body).toMatchObject({
      referral_session_key: sessionKey,
      canonical_referral_token: canonicalToken,
      external_user_id: oveAccountId,
      common_user_id: capturedCommonUserId,
    });

    const referral = await prisma.walletReferral.findUniqueOrThrow({ where: { walletUserId: oveAccountId } });
    expect(referral.status).toBe("CONFIRMED");
    expect(referral.confirmedAt).not.toBeNull();

    const benefit = await prisma.walletReferralBenefit.findUniqueOrThrow({
      where: { idempotencyKey: `REFERRAL_SIGNUP_BONUS:${oveAccountId}` },
    });
    expect(benefit.status).toBe("CONFIRMED");
    expect(benefit.ledgerTransactionId).not.toBeNull();

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId } });
    expect(wallet.availableBalance.toString()).toBe("3000");

    const transaction = await prisma.oveTransaction.findUniqueOrThrow({
      where: { id: benefit.ledgerTransactionId! },
    });
    expect(transaction.transactionType).toBe("REFERRAL_REWARD");
    expect(transaction.status).toBe("COMPLETED");
  });

  it("leaves the benefit PENDING (no credit) when the agency confirm call fails", async () => {
    hub = await startMockHub((path) => {
      if (path.startsWith("/api/referrals/capture")) {
        return {
          status: 200,
          body: {
            referral_session_key: `rs_test_fail_${generateId()}`,
            canonical_referral_token: `rt_test_fail_${generateId()}`,
            agency_id: "AGENT-CODE-001",
            status: "captured",
          },
        };
      }
      if (path.startsWith("/api/common-users/resolve")) {
        return { status: 200, body: { ok: true, common_user_id: `cu_${generateId()}`, created: true, matched_by: "created" } };
      }
      if (path.startsWith("/api/referrals/confirm")) {
        return { status: 500, body: { ok: false } };
      }
      return { status: 404, body: { ok: false } };
    });
    await seedConfig({ baseUrl: hub.url, apiKey: "test-outbound-key" });

    const rawToken = `referral-phase2-fail-${generateId()}`;
    const captureRes = await request(app.getHttpServer()).get(`/api/v1/referrals/capture?token=${rawToken}`).expect(302);
    const cookieValue = extractCookie(captureRes.headers["set-cookie"] as unknown as string[], REFERRAL_SESSION_COOKIE_NAME);

    const lineUserId = `e2e-phase2-fail-${generateId()}`;
    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/auth/line/login")
      .set("Cookie", [`${REFERRAL_SESSION_COOKIE_NAME}=${cookieValue}`])
      .send({ idToken: `mock.${lineUserId}`, termsAccepted: true })
      .expect(201);
    const oveAccountId = loginRes.body.ove_account_id as string;

    const referral = await prisma.walletReferral.findUniqueOrThrow({ where: { walletUserId: oveAccountId } });
    expect(referral.status).toBe("PENDING"); // confirm失敗、後続イベント受信での確定に委ねる

    const benefit = await prisma.walletReferralBenefit.findUniqueOrThrow({
      where: { idempotencyKey: `REFERRAL_SIGNUP_BONUS:${oveAccountId}` },
    });
    expect(benefit.status).toBe("PENDING");

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId } });
    expect(wallet.availableBalance.toString()).toBe("0");
  });
});
