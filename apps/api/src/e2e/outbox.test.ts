import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { hashSecret } from "@ove/auth";
import { prisma, generateId } from "@ove/database";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../app.module";
import { LedgerExceptionFilter } from "../common/ledger-exception.filter";
import { OutboxService, type OutboxEvent } from "../outbox/outbox.service";

// 2つの describe で個別に NestFactory.create()/app.close() を行うと、
// KeyValueStoreModule の Redis クライアントがプロセス内(このテストファイルの
// モジュールレジストリ内)で共有シングルトンであるため、先に閉じたほうの
// app.close() が Redis 接続を quit() してしまい、後段の describe が
// "Connection is closed." で失敗する。そのため本ファイル内では Nest app を
// 1つだけ生成し、両方の describe で使い回す。
let app: INestApplication;
let outbox: OutboxService;

beforeAll(async () => {
  // 他のe2eテストファイル (agency-referral.test.ts等) がAGENCY_SYSTEM宛のイベントを
  // enqueueするが、そちらにはハンドラが登録されないため永久にPENDINGのまま残る。
  // 共有DBに対して繰り返しテストを実行するとこうした行が積み上がり、
  // processPendingEvents()のデフォルト取得件数(20件)を古い行が埋めてしまい、
  // このファイル自身が新規登録したイベントが処理対象に入らなくなる不具合があった。
  // このファイルの前提を決定的にするため、開始時に一度だけ全件クリアする。
  await prisma.integrationOutbox.deleteMany({});

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

async function loginAsNewAdmin(displayName: string): Promise<string[]> {
  const email = `e2e-${generateId()}@ovewallet.local`;
  const password = "e2e-test-password-123";
  await prisma.adminUser.create({
    data: {
      id: generateId(),
      adminCode: `OVE-ADM-${generateId()}`,
      email,
      passwordHash: hashSecret(password),
      role: "SUPER_ADMIN",
      displayName,
    },
  });
  const loginRes = await request(app.getHttpServer()).post("/api/v1/admin/login").send({ email, password }).expect(201);
  return loginRes.headers["set-cookie"] as unknown as string[];
}

describe("Transactional Outbox (開発ガイドライン10章)", () => {
  let adminCookie: string[];

  beforeAll(async () => {
    adminCookie = await loginAsNewAdmin("E2E Outbox Admin");
  });

  it("enqueue is idempotent on idempotencyKey (does not create duplicate rows)", async () => {
    const idempotencyKey = `TEST_ENQUEUE:${generateId()}`;
    const params = {
      eventType: "TEST_EVENT",
      aggregateType: "test",
      aggregateId: generateId(),
      destinationService: "TEST_DESTINATION",
      payload: { hello: "world" },
      idempotencyKey,
    };
    await outbox.enqueue(prisma, params);
    await outbox.enqueue(prisma, params); // 再送・リトライ相当の二重呼び出し

    const rows = await prisma.integrationOutbox.findMany({ where: { idempotencyKey } });
    expect(rows).toHaveLength(1);
  });

  it("processPendingEvents dispatches to the registered destination handler and marks SENT", async () => {
    const destination = `TEST_DEST_OK_${generateId()}`;
    const received: OutboxEvent[] = [];
    outbox.registerDestination(destination, {
      send: async (event) => {
        received.push(event);
      },
    });

    const idempotencyKey = `TEST_OK:${generateId()}`;
    await outbox.enqueue(prisma, {
      eventType: "TEST_EVENT",
      aggregateType: "test",
      aggregateId: generateId(),
      destinationService: destination,
      payload: { amount: 100 },
      idempotencyKey,
    });

    const result = await outbox.processPendingEvents();
    expect(result.processed).toBeGreaterThanOrEqual(1);
    expect(received).toHaveLength(1);
    expect(received[0]!.payload).toEqual({ amount: 100 });

    const row = await prisma.integrationOutbox.findUniqueOrThrow({ where: { idempotencyKey } });
    expect(row.status).toBe("SENT");
    expect(row.processedAt).not.toBeNull();
  });

  it("a failing handler is retried with exponential backoff, and eventually marked FAILED after max attempts", async () => {
    const destination = `TEST_DEST_FAIL_${generateId()}`;
    let callCount = 0;
    outbox.registerDestination(destination, {
      send: async () => {
        callCount++;
        throw new Error("simulated destination failure");
      },
    });

    const idempotencyKey = `TEST_FAIL:${generateId()}`;
    await outbox.enqueue(prisma, {
      eventType: "TEST_EVENT",
      aggregateType: "test",
      aggregateId: generateId(),
      destinationService: destination,
      payload: {},
      idempotencyKey,
    });

    const firstAttempt = await outbox.processPendingEvents();
    expect(firstAttempt.failed).toBeGreaterThanOrEqual(1);
    expect(callCount).toBe(1);

    const afterFirstFailure = await prisma.integrationOutbox.findUniqueOrThrow({ where: { idempotencyKey } });
    expect(afterFirstFailure.status).toBe("PENDING"); // 再送待ち
    expect(afterFirstFailure.attemptCount).toBe(1);
    expect(afterFirstFailure.availableAt.getTime()).toBeGreaterThan(Date.now()); // バックオフで未来にずれている
    expect(afterFirstFailure.lastErrorMessage).toContain("simulated destination failure");

    // まだ再送期日前なので、この時点では処理対象にならない
    const tooEarly = await outbox.processPendingEvents();
    expect(callCount).toBe(1);
    void tooEarly;

    // 再送期日を強制的に前倒しして、上限に達するまで処理を繰り返す
    for (let i = 0; i < 10; i++) {
      const row = await prisma.integrationOutbox.findUnique({ where: { idempotencyKey } });
      if (!row || row.status === "FAILED") break;
      await prisma.integrationOutbox.update({ where: { idempotencyKey }, data: { availableAt: new Date() } });
      await outbox.processPendingEvents();
    }

    const final = await prisma.integrationOutbox.findUniqueOrThrow({ where: { idempotencyKey } });
    expect(final.status).toBe("FAILED");
    expect(final.attemptCount).toBeGreaterThanOrEqual(8);
  });

  it("manual retry resets a FAILED event back to PENDING with attemptCount 0", async () => {
    const idempotencyKey = `TEST_MANUAL_RETRY:${generateId()}`;
    const created = await outbox.enqueue(prisma, {
      eventType: "TEST_EVENT",
      aggregateType: "test",
      aggregateId: generateId(),
      destinationService: `TEST_DEST_MANUAL_${generateId()}`,
      payload: {},
      idempotencyKey,
    });
    await prisma.integrationOutbox.update({
      where: { id: created.id },
      data: { status: "FAILED", attemptCount: 8, lastErrorMessage: "dead" },
    });

    await request(app.getHttpServer()).post(`/api/v1/admin/outbox/${created.id}/retry`).set("Cookie", adminCookie).expect(201);

    const row = await prisma.integrationOutbox.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.status).toBe("PENDING");
    expect(row.attemptCount).toBe(0);
  });

  it("admin can list/filter the outbox queue and trigger a dispatch", async () => {
    const destination = `TEST_DEST_LIST_${generateId()}`;
    outbox.registerDestination(destination, { send: async () => {} });
    const idempotencyKey = `TEST_LIST:${generateId()}`;
    await outbox.enqueue(prisma, {
      eventType: "TEST_EVENT",
      aggregateType: "test",
      aggregateId: generateId(),
      destinationService: destination,
      payload: {},
      idempotencyKey,
    });

    const listRes = await request(app.getHttpServer())
      .get(`/api/v1/admin/outbox?destinationService=${destination}`)
      .set("Cookie", adminCookie)
      .expect(200);
    expect(listRes.body).toHaveLength(1);
    expect(listRes.body[0].idempotencyKey).toBe(idempotencyKey);

    const dispatchRes = await request(app.getHttpServer()).post("/api/v1/admin/outbox/dispatch").set("Cookie", adminCookie).expect(201);
    expect(dispatchRes.body.processed).toBeGreaterThanOrEqual(1);
  });

  it("rejects unauthenticated access to admin outbox endpoints", async () => {
    await request(app.getHttpServer()).get("/api/v1/admin/outbox").expect(401);
    await request(app.getHttpServer()).post("/api/v1/admin/outbox/dispatch").expect(401);
  });
});

describe("Feature Flags (開発ガイドライン13章)", () => {
  let adminCookie: string[];

  beforeAll(async () => {
    adminCookie = await loginAsNewAdmin("E2E FeatureFlags Admin");
  });

  it("all flags default to false unless explicitly set to \"true\"", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/admin/feature-flags").set("Cookie", adminCookie).expect(200);
    expect(res.body).toEqual({
      ENABLE_PLATFORM_USER_ID: false,
      ENABLE_WALLET_REFERRAL_TOKEN: false,
      ENABLE_AGENCY_REFERRAL_SYNC: false,
      ENABLE_AGENCY_SYNC_RETRY: false,
      ENABLE_WALLET_REGISTRATION_BONUS: false,
      ENABLE_EXTERNAL_REWARD_TYPES: false,
      ENABLE_ONCHAIN_MIGRATION: false,
      ENABLE_COMMON_EVENT_INBOX: false,
      ENABLE_DIGITAL_COLLECTION: false,
      ENABLE_COLLECTIBLE_ENTITLEMENT_INBOX: false,
    });
  });

  it("rejects unauthenticated access", async () => {
    await request(app.getHttpServer()).get("/api/v1/admin/feature-flags").expect(401);
  });
});
