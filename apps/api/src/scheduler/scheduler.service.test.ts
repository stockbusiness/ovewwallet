import { SchedulerRegistry } from "@nestjs/schedule";
import { InMemoryKeyValueStore } from "@ove/auth";
import {
  SchedulerService,
  JOB_CREDIT_EXPIRY,
  JOB_DATA_RETENTION,
  JOB_EXPIRY_NOTICE,
  JOB_LIABILITY_SNAPSHOT,
  JOB_OUTBOX_DISPATCH,
  JOB_RECONCILIATION,
} from "./scheduler.service";
import type { AdminService } from "../admin/admin.service";
import type { AdminRewardRulesService } from "../admin/admin-reward-rules.service";
import type { DataRetentionService } from "./data-retention.service";
import type { ExpiryNoticeService } from "./expiry-notice.service";
import type { PointLiabilityService } from "../reporting/point-liability.service";
import type { OutboxService } from "../outbox/outbox.service";

function build(overrides: {
  admin?: Partial<AdminService>;
  rewardRules?: Partial<AdminRewardRulesService>;
  outbox?: Partial<OutboxService>;
  retention?: Partial<DataRetentionService>;
  expiryNotice?: Partial<ExpiryNoticeService>;
  pointLiability?: Partial<PointLiabilityService>;
  kv?: InMemoryKeyValueStore;
} = {}) {
  const kv = overrides.kv ?? new InMemoryKeyValueStore();
  const admin = {
    reconcile: jest.fn().mockResolvedValue({ checkedWalletCount: 3, mismatchedWalletCount: 0, mismatched: [] }),
    ...overrides.admin,
  } as unknown as AdminService;
  const rewardRules = {
    runExpiryBatch: jest.fn().mockResolvedValue({ wallets_processed: 2, total_expired_amount: "700" }),
    ...overrides.rewardRules,
  } as unknown as AdminRewardRulesService;
  const outbox = {
    processPendingEvents: jest.fn().mockResolvedValue({ processed: 0, failed: 0 }),
    ...overrides.outbox,
  } as unknown as OutboxService;

  const retention = {
    purgeExpiredData: jest.fn().mockResolvedValue({ userSessions: 4, apiAccessLogs: 9, sentOutboxEvents: 1 }),
    ...overrides.retention,
  } as unknown as DataRetentionService;

  const expiryNotice = {
    createExpiryNotices: jest.fn().mockResolvedValue({ accountsNotified: 2, lotsMarked: 3 }),
    ...overrides.expiryNotice,
  } as unknown as ExpiryNoticeService;

  const pointLiability = {
    captureMonthEndSnapshot: jest.fn().mockResolvedValue({ created: true }),
    ...overrides.pointLiability,
  } as unknown as PointLiabilityService;

  const registry = new SchedulerRegistry();
  const service = new SchedulerService(
    registry,
    admin,
    rewardRules,
    outbox,
    retention,
    expiryNotice,
    pointLiability,
    kv,
  );
  return { service, registry, admin, rewardRules, outbox, retention, expiryNotice, pointLiability, kv };
}

describe("SchedulerService", () => {
  const original = process.env.SCHEDULER_ENABLED;

  afterEach(() => {
    process.env.SCHEDULER_ENABLED = original;
    jest.restoreAllMocks();
  });

  describe("ジョブ登録", () => {
    it("registers every job when enabled", () => {
      delete process.env.SCHEDULER_ENABLED; // 未設定=有効 (既定ON)
      const { service, registry } = build();

      service.onModuleInit();
      expect(registry.getCronJob(JOB_CREDIT_EXPIRY)).toBeDefined();
      expect(registry.getCronJob(JOB_RECONCILIATION)).toBeDefined();
      expect(registry.getCronJob(JOB_OUTBOX_DISPATCH)).toBeDefined();
      expect(registry.getCronJob(JOB_DATA_RETENTION)).toBeDefined();
      expect(registry.getCronJob(JOB_EXPIRY_NOTICE)).toBeDefined();
      expect(registry.getCronJob(JOB_LIABILITY_SNAPSHOT)).toBeDefined();

      service.onModuleDestroy();
      // 停止後はタイマーが残らない (プロセスが終了できる)
      expect(() => registry.getCronJob(JOB_CREDIT_EXPIRY)).toThrow();
    });

    it("registers nothing when SCHEDULER_ENABLED=false", () => {
      process.env.SCHEDULER_ENABLED = "false";
      const { service, registry } = build();

      service.onModuleInit();
      expect(registry.getCronJobs().size).toBe(0);

      service.onModuleDestroy();
    });

    it("keeps the other jobs registered when one cron expression is invalid", () => {
      delete process.env.SCHEDULER_ENABLED;
      process.env.EXPIRY_CRON = "not a cron expression";
      try {
        const { service, registry } = build();
        service.onModuleInit();

        expect(() => registry.getCronJob(JOB_CREDIT_EXPIRY)).toThrow();
        expect(registry.getCronJob(JOB_RECONCILIATION)).toBeDefined();
        expect(registry.getCronJob(JOB_OUTBOX_DISPATCH)).toBeDefined();

        service.onModuleDestroy();
      } finally {
        delete process.env.EXPIRY_CRON;
      }
    });
  });

  describe("実処理の呼び出し", () => {
    it("runs the same expiry batch as the admin screen", async () => {
      const { service, rewardRules } = build();
      await expect(service.runCreditExpiry()).resolves.toBe(true);
      expect(rewardRules.runExpiryBatch).toHaveBeenCalledTimes(1);
    });

    it("runs reconciliation (mismatch alerting lives in AdminService)", async () => {
      const { service, admin } = build();
      await expect(service.runReconciliation()).resolves.toBe(true);
      expect(admin.reconcile).toHaveBeenCalledTimes(1);
    });

    it("keeps draining the outbox until nothing is left", async () => {
      const processPendingEvents = jest
        .fn()
        .mockResolvedValueOnce({ processed: 20, failed: 0 })
        .mockResolvedValueOnce({ processed: 5, failed: 1 })
        .mockResolvedValue({ processed: 0, failed: 0 });
      const { service } = build({ outbox: { processPendingEvents } as unknown as Partial<OutboxService> });

      await expect(service.runOutboxDispatch()).resolves.toBe(true);
      // 3回目に空になった時点で止まる (上限10回まで回さない)
      expect(processPendingEvents).toHaveBeenCalledTimes(3);
    });

    it("stops draining the outbox at the per-tick batch cap", async () => {
      const processPendingEvents = jest.fn().mockResolvedValue({ processed: 20, failed: 0 });
      const { service } = build({ outbox: { processPendingEvents } as unknown as Partial<OutboxService> });

      await expect(service.runOutboxDispatch()).resolves.toBe(true);
      expect(processPendingEvents).toHaveBeenCalledTimes(10); // OUTBOX_MAX_BATCHES_PER_TICK
    });

    it("runs the data retention purge", async () => {
      const { service, retention } = build();
      await expect(service.runDataRetention()).resolves.toBe(true);
      expect(retention.purgeExpiredData).toHaveBeenCalledTimes(1);
    });

    it("runs the expiry notice job", async () => {
      const { service, expiryNotice } = build();
      await expect(service.runExpiryNotice()).resolves.toBe(true);
      expect(expiryNotice.createExpiryNotices).toHaveBeenCalledTimes(1);
    });

    it("runs the monthly point liability snapshot for the previous month", async () => {
      const { service, pointLiability } = build();
      await expect(service.runLiabilitySnapshot()).resolves.toBe(true);
      // 対象は「締まった直近の月」= 前月 (まだ終わっていない当月は締められない)
      expect(pointLiability.captureMonthEndSnapshot).toHaveBeenCalledWith(
        expect.stringMatching(/^\d{4}-\d{2}$/),
      );
    });
  });

  describe("多重実行の防止と異常系", () => {
    it("skips the run when another instance holds the lock", async () => {
      const kv = new InMemoryKeyValueStore();
      // 先行インスタンスがロックを保持している状態を作る
      await kv.incr(`scheduler-lock:${JOB_CREDIT_EXPIRY}`, 900);

      const { service, rewardRules } = build({ kv });
      await expect(service.runCreditExpiry()).resolves.toBe(false);
      expect(rewardRules.runExpiryBatch).not.toHaveBeenCalled();
    });

    it("releases the lock so the next run can proceed", async () => {
      const { service, rewardRules } = build();
      await expect(service.runCreditExpiry()).resolves.toBe(true);
      await expect(service.runCreditExpiry()).resolves.toBe(true);
      expect(rewardRules.runExpiryBatch).toHaveBeenCalledTimes(2);
    });

    it("releases the lock and does not throw when the job fails", async () => {
      const runExpiryBatch = jest
        .fn()
        .mockRejectedValueOnce(new Error("boom"))
        .mockResolvedValue({ wallets_processed: 0, total_expired_amount: "0" });
      const { service } = build({
        rewardRules: { runExpiryBatch } as unknown as Partial<AdminRewardRulesService>,
      });

      // 失敗してもプロセスを落とさない (次回の実行機会を残す)
      await expect(service.runCreditExpiry()).resolves.toBe(true);
      // ロックが解放されているので次回も実行できる
      await expect(service.runCreditExpiry()).resolves.toBe(true);
      expect(runExpiryBatch).toHaveBeenCalledTimes(2);
    });
  });
});
