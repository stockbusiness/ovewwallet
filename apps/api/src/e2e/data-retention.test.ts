import "reflect-metadata";
import { prisma, generateId, nextDisplayCode, ACCOUNT_CODE_COUNTER } from "@ove/database";
import { DataRetentionService } from "../scheduler/data-retention.service";
import {
  API_ACCESS_LOG_RETENTION_DAYS,
  OUTBOX_SENT_RETENTION_DAYS,
  USER_SESSION_RETENTION_DAYS,
} from "../scheduler/scheduler.config";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

/**
 * データ保持ジョブ。保持期間を過ぎた行だけを消し、まだ必要な行・削除してはいけない行を
 * 残すことを検証する。
 */
describe("データ保持 (期限切れ行の削除)", () => {
  const service = new DataRetentionService(prisma);
  let oveAccountId: string;
  const tag = generateId();

  beforeAll(async () => {
    const accountCode = await nextDisplayCode(prisma, ACCOUNT_CODE_COUNTER, "OVE-ACC");
    const account = await prisma.oveAccount.create({
      data: { id: generateId(), accountCode, status: "ACTIVE", displayName: "Retention E2E" },
    });
    oveAccountId = account.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("deletes long-expired sessions but keeps active and recently expired ones", async () => {
    const old = await prisma.userSession.create({
      data: {
        id: generateId(),
        oveAccountId,
        sessionTokenHash: `retention-old-${generateId()}`,
        expiresAt: daysAgo(USER_SESSION_RETENTION_DAYS + 10),
      },
    });
    const recentlyExpired = await prisma.userSession.create({
      data: {
        id: generateId(),
        oveAccountId,
        sessionTokenHash: `retention-recent-${generateId()}`,
        expiresAt: daysAgo(1),
      },
    });
    const active = await prisma.userSession.create({
      data: {
        id: generateId(),
        oveAccountId,
        sessionTokenHash: `retention-active-${generateId()}`,
        expiresAt: new Date(Date.now() + 30 * DAY_MS),
      },
    });

    await service.purgeExpiredData();

    expect(await prisma.userSession.findUnique({ where: { id: old.id } })).toBeNull();
    // 期限切れ直後は調査のために残す
    expect(await prisma.userSession.findUnique({ where: { id: recentlyExpired.id } })).not.toBeNull();
    expect(await prisma.userSession.findUnique({ where: { id: active.id } })).not.toBeNull();
  });

  it("deletes old API access logs but keeps recent ones", async () => {
    const oldLog = await prisma.apiAccessLog.create({
      data: {
        id: generateId(),
        method: "POST",
        path: `/retention-old/${tag}`,
        statusCode: 200,
        createdAt: daysAgo(API_ACCESS_LOG_RETENTION_DAYS + 10),
      },
    });
    const recentLog = await prisma.apiAccessLog.create({
      data: { id: generateId(), method: "POST", path: `/retention-recent/${tag}`, statusCode: 200 },
    });

    await service.purgeExpiredData();

    expect(await prisma.apiAccessLog.findUnique({ where: { id: oldLog.id } })).toBeNull();
    expect(await prisma.apiAccessLog.findUnique({ where: { id: recentLog.id } })).not.toBeNull();
  });

  it("deletes only old SENT outbox events, never PENDING or FAILED ones", async () => {
    const longAgo = daysAgo(OUTBOX_SENT_RETENTION_DAYS + 10);
    const base = {
      eventType: "wallet.referral.registered",
      aggregateType: "wallet_referral",
      aggregateId: generateId(),
      destinationService: "AGENCY_SYSTEM",
      payload: {},
      createdAt: longAgo,
    };

    const sent = await prisma.integrationOutbox.create({
      data: { ...base, id: generateId(), idempotencyKey: `retention-sent-${tag}`, status: "SENT", processedAt: longAgo },
    });
    // 再送上限に達して人手の対応を待っている状態。古くても消してはいけない。
    const failed = await prisma.integrationOutbox.create({
      data: { ...base, id: generateId(), idempotencyKey: `retention-failed-${tag}`, status: "FAILED", processedAt: longAgo },
    });
    // 未送信。古くても消してはいけない。
    const pending = await prisma.integrationOutbox.create({
      data: { ...base, id: generateId(), idempotencyKey: `retention-pending-${tag}`, status: "PENDING" },
    });
    const recentlySent = await prisma.integrationOutbox.create({
      data: {
        ...base,
        id: generateId(),
        idempotencyKey: `retention-sent-recent-${tag}`,
        status: "SENT",
        processedAt: new Date(),
      },
    });

    await service.purgeExpiredData();

    expect(await prisma.integrationOutbox.findUnique({ where: { id: sent.id } })).toBeNull();
    expect(await prisma.integrationOutbox.findUnique({ where: { id: failed.id } })).not.toBeNull();
    expect(await prisma.integrationOutbox.findUnique({ where: { id: pending.id } })).not.toBeNull();
    expect(await prisma.integrationOutbox.findUnique({ where: { id: recentlySent.id } })).not.toBeNull();
  });

  it("never touches audit logs or transactions (they are immutable by design)", async () => {
    const auditLog = await prisma.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actionType: "RETENTION_E2E",
        targetType: "admin_user",
        result: "SUCCESS",
        createdAt: daysAgo(3650),
      },
    });

    await service.purgeExpiredData();

    // 10年前の監査ログでも残る (DBトリガーでDELETE自体が禁止されており、
    // ジョブも対象にしていない)
    expect(await prisma.auditLog.findUnique({ where: { id: auditLog.id } })).not.toBeNull();
  });

  it("reports how many rows were deleted", async () => {
    await prisma.userSession.create({
      data: {
        id: generateId(),
        oveAccountId,
        sessionTokenHash: `retention-count-${generateId()}`,
        expiresAt: daysAgo(USER_SESSION_RETENTION_DAYS + 10),
      },
    });

    const result = await service.purgeExpiredData();
    expect(result.userSessions).toBeGreaterThanOrEqual(1);
    expect(result).toMatchObject({
      userSessions: expect.any(Number),
      apiAccessLogs: expect.any(Number),
      sentOutboxEvents: expect.any(Number),
    });

    // 続けて実行すると、もう消すものが無いので0件になる
    const second = await service.purgeExpiredData();
    expect(second.userSessions).toBe(0);
  });
});
