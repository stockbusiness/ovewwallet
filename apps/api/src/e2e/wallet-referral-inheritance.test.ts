import "reflect-metadata";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { encryptSecret, generateOpaqueToken, hashSecret } from "@ove/auth";
import { prisma, generateId, nextDisplayCode, ACCOUNT_CODE_COUNTER } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { OutboxService } from "../outbox/outbox.service";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-only-insecure-encryption-key";
const CONFIG_ID = "default";
const INHERITANCE_PATH = "/api/referrals/inheritance";

interface MockAgency {
  url: string;
  requests: { path: string; body: Record<string, unknown> }[];
  close: () => Promise<void>;
  respondWith: (status: number, body: unknown) => void;
}

/** 代理店システム (sengoku-ai.com) の代わりに立てるテスト用モックサーバー。 */
async function startMockAgency(): Promise<MockAgency> {
  const state = { status: 200, body: { ok: true, accepted: true } as unknown };
  const requests: { path: string; body: Record<string, unknown> }[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      requests.push({ path: req.url ?? "", body: raw ? JSON.parse(raw) : {} });
      res.statusCode = state.status;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(state.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    respondWith: (status, body) => {
      state.status = status;
      state.body = body;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/**
 * ウォレット紹介の継承申請 (`docs/wallet-user-referral.md` Phase 2)。
 *
 * 固定したいのは、代理店資格の取得を検知して申請を送ることと、
 * **同じ紹介を二度申請しない**こと (情報更新の同期が何度届いても)。
 */
describe("ウォレット紹介の継承申請", () => {
  let app: INestApplication;
  let outbox: OutboxService;
  let agency: MockAgency;
  let partnerApiKey: string;

  async function createAccount(commonUserId?: string): Promise<string> {
    const id = generateId();
    await prisma.oveAccount.create({
      data: {
        id,
        accountCode: await nextDisplayCode(prisma, ACCOUNT_CODE_COUNTER, "OVE-ACC"),
        status: "ACTIVE",
        commonUserId,
        commonUserLinkedAt: commonUserId ? new Date() : null,
      },
    });
    return id;
  }

  async function createReferral(referrerAccountId: string, referredAccountId: string): Promise<string> {
    const id = generateId();
    await prisma.walletUserReferral.create({
      data: {
        id,
        referrerAccountId,
        referredAccountId,
        sessionTokenHash: `hash-${id}`,
        status: "REGISTERED",
        expiresAt: new Date(Date.now() + 86_400_000),
        registeredAt: new Date(),
      },
    });
    return id;
  }

  /** 代理店同期を1回送る (= 代理店資格の取得・更新の通知)。 */
  async function syncAgency(commonUserId: string): Promise<void> {
    await request(app.getHttpServer())
      .post("/api/integrations/agencies")
      .set("x-api-key", partnerApiKey)
      .send({
        external_id: `agent-${generateId()}`,
        agent_code: `AG-${generateId().slice(-6)}`,
        common_user_id: commonUserId,
      })
      .expect(201);
  }

  beforeAll(async () => {
    // 他のe2eテストファイルがAGENCY_SYSTEM宛にenqueueしたイベントが残っていると、
    // processPendingEvents()が古い行 (createdAt昇順) から処理してこのファイルが
    // 登録したイベントが対象に入らず、送信の検証が落ちる (`outbox.test.ts`・
    // `agency-referral-outbox.test.ts`と同じ既知の問題)。このファイルの前提を
    // 決定的にするため、開始時に一度だけAGENCY_SYSTEM宛の残留イベントをクリアする。
    await prisma.integrationOutbox.deleteMany({ where: { destinationService: "AGENCY_SYSTEM" } });

    app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
    app.use(cookieParser());
    app.useGlobalFilters(new LedgerExceptionFilter());
    await app.init();
    outbox = app.get(OutboxService);

    partnerApiKey = `wri-test-${generateOpaqueToken(16)}`;
    await prisma.serviceIntegration.upsert({
      where: { serviceCode: "AGENCY_SYSTEM" },
      update: { apiKeyHash: hashSecret(partnerApiKey), status: "ACTIVE" },
      create: {
        id: generateId(),
        serviceCode: "AGENCY_SYSTEM",
        serviceName: "test",
        apiKeyHash: hashSecret(partnerApiKey),
        signingSecretEncrypted: encryptSecret(generateOpaqueToken(32), ENCRYPTION_KEY),
        allowedIps: [],
        dailyAmountLimit: 0,
        perRequestAmountLimit: 0,
      },
    });
  });

  beforeEach(async () => {
    agency = await startMockAgency();
    await prisma.commonUserHubConfig.upsert({
      where: { id: CONFIG_ID },
      create: {
        id: CONFIG_ID,
        baseUrl: agency.url,
        systemKey: "orly-wallet",
        apiKeyEncrypted: encryptSecret("test-outbound-key", ENCRYPTION_KEY),
        apiKeyPreview: "****-key",
      },
      update: {
        baseUrl: agency.url,
        systemKey: "orly-wallet",
        apiKeyEncrypted: encryptSecret("test-outbound-key", ENCRYPTION_KEY),
      },
    });
    process.env.ENABLE_AGENCY_REFERRAL_SYNC = "true";
    process.env.ENABLE_WALLET_USER_REFERRAL_INHERITANCE = "true";
    process.env.AGENCY_REFERRAL_INHERITANCE_PATH = INHERITANCE_PATH;
  });

  afterEach(async () => {
    await agency.close();
    delete process.env.ENABLE_AGENCY_REFERRAL_SYNC;
    delete process.env.ENABLE_WALLET_USER_REFERRAL_INHERITANCE;
    delete process.env.AGENCY_REFERRAL_INHERITANCE_PATH;
    await prisma.commonUserHubConfig.deleteMany({ where: { id: CONFIG_ID } });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("代理店資格の取得を検知して継承申請を送る", async () => {
    const commonUserId = `cu_referrer_${generateId()}`;
    const referrer = await createAccount(commonUserId);
    const referred = await createAccount(`cu_referred_${generateId()}`);
    const referralId = await createReferral(referrer, referred);

    await syncAgency(commonUserId);

    // 申請済みになり、Outboxへ積まれる。
    const after = await prisma.walletUserReferral.findUniqueOrThrow({ where: { id: referralId } });
    expect(after.status).toBe("INHERITED");
    expect(after.inheritedAt).not.toBeNull();

    const row = await prisma.integrationOutbox.findUniqueOrThrow({
      where: { idempotencyKey: `WALLET_REFERRAL_INHERITANCE_REQUESTED:${referralId}` },
    });
    expect(row.eventType).toBe("wallet.referral.inheritance.requested");
    expect(row.destinationService).toBe("AGENCY_SYSTEM");

    // 送信すると、先方の仕様どおりの項目で届く。
    await outbox.processPendingEvents(50);
    const sent = agency.requests.filter((r) => r.path === INHERITANCE_PATH);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({
      event_id: `wri_${referralId}`,
      event_type: "wallet.referral.inheritance.requested",
      source_system_key: "orly-wallet",
      referrer_common_user_id: commonUserId,
      referral_record_id: referralId,
    });
    // referred_at はタイムゾーン付きISO 8601。
    expect(String(sent[0]!.body.referred_at)).toMatch(/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/);

    expect(await prisma.integrationOutbox.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: "SENT",
    });
  });

  it("同期が何度届いても同じ紹介を二度申請しない", async () => {
    const commonUserId = `cu_repeat_${generateId()}`;
    const referrer = await createAccount(commonUserId);
    const referred = await createAccount(`cu_referred_${generateId()}`);
    const referralId = await createReferral(referrer, referred);

    await syncAgency(commonUserId);
    await syncAgency(commonUserId);
    await syncAgency(commonUserId);

    const rows = await prisma.integrationOutbox.findMany({
      where: { aggregateType: "wallet_user_referral", aggregateId: referralId },
    });
    expect(rows).toHaveLength(1);
  });

  it("受信パスが未設定なら申請を作らない (誤ったURLへ再送し続けない)", async () => {
    delete process.env.AGENCY_REFERRAL_INHERITANCE_PATH;
    const commonUserId = `cu_nopath_${generateId()}`;
    const referrer = await createAccount(commonUserId);
    const referred = await createAccount(`cu_referred_${generateId()}`);
    const referralId = await createReferral(referrer, referred);

    await syncAgency(commonUserId);

    const after = await prisma.walletUserReferral.findUniqueOrThrow({ where: { id: referralId } });
    expect(after.status).toBe("REGISTERED");
    expect(after.inheritedAt).toBeNull();
    expect(
      await prisma.integrationOutbox.count({ where: { aggregateId: referralId } }),
    ).toBe(0);
  });

  it("Feature Flag OFFでは申請を作らない", async () => {
    delete process.env.ENABLE_WALLET_USER_REFERRAL_INHERITANCE;
    const commonUserId = `cu_flagoff_${generateId()}`;
    const referrer = await createAccount(commonUserId);
    const referred = await createAccount(`cu_referred_${generateId()}`);
    const referralId = await createReferral(referrer, referred);

    await syncAgency(commonUserId);

    expect(
      (await prisma.walletUserReferral.findUniqueOrThrow({ where: { id: referralId } })).status,
    ).toBe("REGISTERED");
  });

  it("被紹介者の共通IDが未解決なら申請せず、解決後の同期で拾う", async () => {
    const commonUserId = `cu_unresolved_${generateId()}`;
    const referrer = await createAccount(commonUserId);
    const referred = await createAccount(); // common_user_id なし
    const referralId = await createReferral(referrer, referred);

    await syncAgency(commonUserId);
    expect(
      (await prisma.walletUserReferral.findUniqueOrThrow({ where: { id: referralId } })).status,
    ).toBe("REGISTERED");

    // 共通IDを解決すると、次の同期で申請される。
    await prisma.oveAccount.update({
      where: { id: referred },
      data: { commonUserId: `cu_referred_${generateId()}`, commonUserLinkedAt: new Date() },
    });
    await syncAgency(commonUserId);
    expect(
      (await prisma.walletUserReferral.findUniqueOrThrow({ where: { id: referralId } })).status,
    ).toBe("INHERITED");
  });

  it("紹介者の共通IDが未解決なら申請しない", async () => {
    const referrer = await createAccount(); // common_user_id なし
    const referred = await createAccount(`cu_referred_${generateId()}`);
    const referralId = await createReferral(referrer, referred);

    // 共通IDが無いアカウントは同期の照合でも引けないため、そもそも検知されない。
    await syncAgency(`cu_unknown_${generateId()}`);

    expect(
      (await prisma.walletUserReferral.findUniqueOrThrow({ where: { id: referralId } })).status,
    ).toBe("REGISTERED");
  });

  it("対象外・期限切れの紹介は申請しない", async () => {
    const commonUserId = `cu_excluded_${generateId()}`;
    const referrer = await createAccount(commonUserId);
    const referred = await createAccount(`cu_referred_${generateId()}`);
    const referralId = await createReferral(referrer, referred);
    await prisma.walletUserReferral.update({
      where: { id: referralId },
      data: { status: "EXCLUDED", reason: "agency_referral_takes_precedence" },
    });

    await syncAgency(commonUserId);

    expect(
      (await prisma.walletUserReferral.findUniqueOrThrow({ where: { id: referralId } })).status,
    ).toBe("EXCLUDED");
    expect(await prisma.integrationOutbox.count({ where: { aggregateId: referralId } })).toBe(0);
  });

  it("先方が受け付けなければOutboxは再送待ちのまま残る (申請済みフラグは戻さない)", async () => {
    agency.respondWith(500, { ok: false });
    const commonUserId = `cu_fail_${generateId()}`;
    const referrer = await createAccount(commonUserId);
    const referred = await createAccount(`cu_referred_${generateId()}`);
    const referralId = await createReferral(referrer, referred);

    await syncAgency(commonUserId);
    await outbox.processPendingEvents(50);

    const row = await prisma.integrationOutbox.findUniqueOrThrow({
      where: { idempotencyKey: `WALLET_REFERRAL_INHERITANCE_REQUESTED:${referralId}` },
    });
    expect(row.status).toBe("PENDING");
    expect(row.attemptCount).toBeGreaterThan(0);
  });
});
