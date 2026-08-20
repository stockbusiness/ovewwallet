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
import { OutboxService } from "../outbox/outbox.service";
import { REFERRAL_SESSION_COOKIE_NAME } from "../referrals/referrals.controller";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-only-insecure-encryption-key";
const CONFIG_ID = "default";

interface MockHubServer {
  url: string;
  confirmCallCount: number;
  close: () => Promise<void>;
}

/**
 * 代理店システムのモックサーバー。confirm呼出は`confirmStatus`で毎回応答を変えられる
 * (同期呼び出し失敗→Outbox再送での成功、という時系列を再現するため)。
 */
function startMockHub(getConfirmStatus: () => number): Promise<MockHubServer> {
  const state = { confirmCallCount: 0 };
  return new Promise((resolveServer) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const path = req.url ?? "";
        res.setHeader("content-type", "application/json");
        if (path.startsWith("/api/referrals/capture")) {
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              referral_session_key: `rs_outbox_${generateId()}`,
              canonical_referral_token: `rt_outbox_${generateId()}`,
              agency_id: "AGENT-CODE-001",
              status: "captured",
            }),
          );
          return;
        }
        if (path.startsWith("/api/common-users/resolve")) {
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true, common_user_id: `cu_outbox_${generateId()}`, created: true, matched_by: "created" }));
          return;
        }
        if (path.startsWith("/api/referrals/confirm")) {
          state.confirmCallCount++;
          const status = getConfirmStatus();
          res.statusCode = status;
          res.end(status === 200 ? JSON.stringify({ status: "confirmed" }) : JSON.stringify({ ok: false }));
          return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolveServer({
        url: `http://127.0.0.1:${port}`,
        get confirmCallCount() {
          return state.confirmCallCount;
        },
        close: () => new Promise((resolve) => server.close(() => resolve())),
      });
    });
  });
}

async function seedConfig(baseUrl: string): Promise<void> {
  await prisma.commonUserHubConfig.upsert({
    where: { id: CONFIG_ID },
    create: {
      id: CONFIG_ID,
      baseUrl,
      systemKey: "ove-wallet",
      apiKeyEncrypted: encryptSecret("test-outbound-key", ENCRYPTION_KEY),
      apiKeyPreview: "****key1",
    },
    update: { baseUrl, apiKeyEncrypted: encryptSecret("test-outbound-key", ENCRYPTION_KEY), apiKeyPreview: "****key1" },
  });
}

function extractCookie(setCookieHeader: string[] | undefined, name: string): string | undefined {
  const raw = setCookieHeader?.find((c) => c.startsWith(`${name}=`));
  if (!raw) return undefined;
  const match = raw.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1];
}

async function loginAsNewAdmin(app: INestApplication): Promise<string[]> {
  const email = `e2e-outbox-${generateId()}@ovewallet.local`;
  const password = "e2e-test-password-123";
  await prisma.adminUser.create({
    data: {
      id: generateId(),
      adminCode: `OVE-ADM-${generateId()}`,
      email,
      passwordHash: hashSecret(password),
      role: "SUPER_ADMIN",
      displayName: "E2E Outbox Admin",
    },
  });
  const res = await request(app.getHttpServer()).post("/api/v1/admin/login").send({ email, password }).expect(201);
  return res.headers["set-cookie"] as unknown as string[];
}

/**
 * 全システム横断連携分析 H章シナリオ#12「ウォレット紹介Outboxに登録するが送信ワーカーなし
 * → 紹介特典がPENDINGのまま」の解消を検証する。同期のconfirm呼び出しが失敗しても、
 * `wallet.referral.registered`のOutboxイベントを介して後から確定できることを確認する。
 */
describe("AGENCY_SYSTEM宛Outboxイベントの実送信 (wallet.referral.registered)", () => {
  let app: INestApplication;
  let outbox: OutboxService;
  let hub: MockHubServer | undefined;

  beforeAll(async () => {
    // 他のe2eテストファイル(agency-referral.test.ts等)がAGENCY_SYSTEM宛の
    // wallet.referral.registeredイベントをenqueueしたまま残っている場合、
    // processPendingEvents()のデフォルト取得件数(20件、createdAt昇順)がそれらで
    // 埋まってしまい、このファイルが新規登録したイベントが処理対象に入らなくなる
    // (outbox.test.tsと同じ既知の問題)。このファイルの前提を決定的にするため、
    // 開始時に一度だけAGENCY_SYSTEM宛の残留イベントをクリアする。
    await prisma.integrationOutbox.deleteMany({ where: { destinationService: "AGENCY_SYSTEM" } });

    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    outbox = app.get(OutboxService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    process.env.ENABLE_WALLET_REFERRAL_TOKEN = "true";
    process.env.ENABLE_AGENCY_REFERRAL_SYNC = "true";
    process.env.ENABLE_PLATFORM_USER_ID = "true";
    // PR-W1: このスイートは旧特典(3,000 OVE)の確定・CREDITを検証するため明示的にONにする。
    process.env.ENABLE_LEGACY_REFERRAL_SIGNUP_BONUS = "true";
  });

  afterEach(async () => {
    await hub?.close();
    hub = undefined;
    delete process.env.ENABLE_WALLET_REFERRAL_TOKEN;
    delete process.env.ENABLE_AGENCY_REFERRAL_SYNC;
    delete process.env.ENABLE_PLATFORM_USER_ID;
    delete process.env.ENABLE_LEGACY_REFERRAL_SIGNUP_BONUS;
    await prisma.commonUserHubConfig.deleteMany({ where: { id: CONFIG_ID } });
  });

  it("recovers and credits the benefit via Outbox dispatch after the synchronous confirm call failed at login time", async () => {
    let confirmShouldSucceed = false;
    hub = await startMockHub(() => (confirmShouldSucceed ? 200 : 500));
    await seedConfig(hub.url);

    const rawToken = `referral-outbox-${generateId()}`;
    const captureRes = await request(app.getHttpServer()).get(`/api/v1/referrals/capture?token=${rawToken}`).expect(302);
    const cookieValue = extractCookie(captureRes.headers["set-cookie"] as unknown as string[], REFERRAL_SESSION_COOKIE_NAME);

    // ログイン時点ではconfirmが500を返すため、同期確定(confirmAfterCommonUserResolve)は失敗し
    // PENDINGのまま残る (呼び出し元をブロックしないベストエフォート設計の想定通り)。
    const lineUserId = `e2e-outbox-${generateId()}`;
    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/auth/line/login")
      .set("Cookie", [`${REFERRAL_SESSION_COOKIE_NAME}=${cookieValue}`])
      .send({ idToken: `mock.${lineUserId}`, termsAccepted: true })
      .expect(201);
    const oveAccountId = loginRes.body.ove_account_id as string;

    const referralBeforeDispatch = await prisma.walletReferral.findUniqueOrThrow({ where: { walletUserId: oveAccountId } });
    expect(referralBeforeDispatch.status).toBe("PENDING");
    expect(hub.confirmCallCount).toBe(1); // 同期呼び出しの1回のみ

    const outboxEvent = await prisma.integrationOutbox.findUniqueOrThrow({
      where: { idempotencyKey: `WALLET_REFERRAL_REGISTERED:${referralBeforeDispatch.id}` },
    });
    expect(outboxEvent.status).toBe("PENDING");

    // 手動再送1回目: まだconfirmが失敗するため、指数バックオフ再送に乗る
    // (MAX_ATTEMPTS(8)未到達の間はstatus: PENDINGのまま、availableAtだけ先送りされる。
    // FAILEDへ遷移するのは再送上限到達時のみ)。
    const adminCookie = await loginAsNewAdmin(app);
    const firstDispatch = await request(app.getHttpServer())
      .post("/api/v1/admin/outbox/dispatch")
      .set("Cookie", adminCookie)
      .expect(201);
    expect(firstDispatch.body.failed).toBeGreaterThanOrEqual(1);

    const eventAfterFailedDispatch = await prisma.integrationOutbox.findUniqueOrThrow({ where: { id: outboxEvent.id } });
    expect(eventAfterFailedDispatch.status).toBe("PENDING");
    expect(eventAfterFailedDispatch.attemptCount).toBe(1);
    expect(eventAfterFailedDispatch.lastErrorMessage).toMatch(/retry/i);
    expect(eventAfterFailedDispatch.availableAt.getTime()).toBeGreaterThan(Date.now());

    const referralAfterFailedDispatch = await prisma.walletReferral.findUniqueOrThrow({ where: { id: referralBeforeDispatch.id } });
    expect(referralAfterFailedDispatch.status).toBe("PENDING"); // まだ確定していない

    // 代理店システム側の障害が復旧したと仮定し、confirmを成功させたうえで手動再送する。
    confirmShouldSucceed = true;
    await outbox.manualRetry(outboxEvent.id);
    const secondDispatch = await request(app.getHttpServer())
      .post("/api/v1/admin/outbox/dispatch")
      .set("Cookie", adminCookie)
      .expect(201);
    expect(secondDispatch.body.processed).toBeGreaterThanOrEqual(1);

    const eventAfterSuccess = await prisma.integrationOutbox.findUniqueOrThrow({ where: { id: outboxEvent.id } });
    expect(eventAfterSuccess.status).toBe("SENT");

    const referralAfterSuccess = await prisma.walletReferral.findUniqueOrThrow({ where: { id: referralBeforeDispatch.id } });
    expect(referralAfterSuccess.status).toBe("CONFIRMED");

    const benefit = await prisma.walletReferralBenefit.findUniqueOrThrow({
      where: { idempotencyKey: `REFERRAL_SIGNUP_BONUS:${oveAccountId}` },
    });
    expect(benefit.status).toBe("CONFIRMED");

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId } });
    expect(wallet.availableBalance.toString()).toBe("3000");
  });

  it("does not dispatch (and does not error) once the referral has already been confirmed by the synchronous path", async () => {
    hub = await startMockHub(() => 200); // 同期confirmが常に成功する
    await seedConfig(hub.url);

    const rawToken = `referral-outbox-sync-ok-${generateId()}`;
    const captureRes = await request(app.getHttpServer()).get(`/api/v1/referrals/capture?token=${rawToken}`).expect(302);
    const cookieValue = extractCookie(captureRes.headers["set-cookie"] as unknown as string[], REFERRAL_SESSION_COOKIE_NAME);

    const lineUserId = `e2e-outbox-sync-ok-${generateId()}`;
    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/auth/line/login")
      .set("Cookie", [`${REFERRAL_SESSION_COOKIE_NAME}=${cookieValue}`])
      .send({ idToken: `mock.${lineUserId}`, termsAccepted: true })
      .expect(201);
    const oveAccountId = loginRes.body.ove_account_id as string;

    const referral = await prisma.walletReferral.findUniqueOrThrow({ where: { walletUserId: oveAccountId } });
    expect(referral.status).toBe("CONFIRMED"); // 同期確定済み
    expect(hub.confirmCallCount).toBe(1);

    const adminCookie = await loginAsNewAdmin(app);
    await request(app.getHttpServer()).post("/api/v1/admin/outbox/dispatch").set("Cookie", adminCookie).expect(201);

    // Outbox経由での再送は「対象外 (not_applicable)」として成功扱いになり、
    // confirmを再度呼び出したり、二重にOVEを付与したりしない。
    expect(hub.confirmCallCount).toBe(1);
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { oveAccountId } });
    expect(wallet.availableBalance.toString()).toBe("3000");

    const outboxEvent = await prisma.integrationOutbox.findUniqueOrThrow({
      where: { idempotencyKey: `WALLET_REFERRAL_REGISTERED:${referral.id}` },
    });
    expect(outboxEvent.status).toBe("SENT");
  });
});
