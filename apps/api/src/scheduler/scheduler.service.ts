import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import type { KeyValueStore } from "@ove/auth";
import { KV_STORE } from "../common/kv-store.module";
import { maintenanceMode } from "../common/maintenance-mode.middleware";
import { captureException } from "../common/sentry";
import { AdminService } from "../admin/admin.service";
import { AdminRewardRulesService } from "../admin/admin-reward-rules.service";
import { OutboxService } from "../outbox/outbox.service";
import { DataRetentionService } from "./data-retention.service";
import { ExpiryNoticeService } from "./expiry-notice.service";
import { PointLiabilityService } from "../reporting/point-liability.service";
import { AccountAnonymizationService } from "../accounts/account-anonymization.service";
import { CollectibleImagesService } from "../collectible-images/collectible-images.service";
import {
  DEFAULT_EXPIRY_CRON,
  DEFAULT_EXPIRY_NOTICE_CRON,
  DEFAULT_ANONYMIZATION_CRON,
  DEFAULT_COLLECTIBLE_IMAGE_CRON,
  COLLECTIBLE_IMAGE_MAX_PER_TICK,
  DEFAULT_LIABILITY_SNAPSHOT_CRON,
  DEFAULT_OUTBOX_CRON,
  DEFAULT_RECONCILIATION_CRON,
  DEFAULT_RETENTION_CRON,
  JOB_LOCK_TTL_SECONDS,
  OUTBOX_MAX_BATCHES_PER_TICK,
  cronExpression,
  isSchedulerEnabled,
} from "./scheduler.config";

export const JOB_CREDIT_EXPIRY = "credit-expiry";
export const JOB_RECONCILIATION = "reconciliation";
export const JOB_OUTBOX_DISPATCH = "outbox-dispatch";
export const JOB_DATA_RETENTION = "data-retention";
export const JOB_EXPIRY_NOTICE = "expiry-notice";
export const JOB_LIABILITY_SNAPSHOT = "liability-snapshot";
export const JOB_ACCOUNT_ANONYMIZATION = "account-anonymization";
export const JOB_COLLECTIBLE_IMAGE_INGEST = "collectible-image-ingest";

/**
 * 運用処理の定期実行。
 *
 * これまで失効バッチ・整合性チェック・Outbox送信はいずれも管理画面からの手動実行しか
 * 入口が無く、押し忘れると「期限切れORIが失効しない」「連携イベントが滞留したまま
 * エラーにもならない」「残高不整合が検知されない」という状態になっていた。
 *
 * `@Cron`デコレータではなく`SchedulerRegistry`への動的登録を使う。無効時にジョブを
 * 一切登録しないため、タイマーが残らず自動テストへ影響しないため
 * (デコレータは無効時も登録され、ハンドラ内で毎回判定することになる)。
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly registeredJobs: string[] = [];

  constructor(
    private readonly registry: SchedulerRegistry,
    private readonly admin: AdminService,
    private readonly rewardRules: AdminRewardRulesService,
    private readonly outbox: OutboxService,
    private readonly retention: DataRetentionService,
    private readonly expiryNotice: ExpiryNoticeService,
    private readonly pointLiability: PointLiabilityService,
    private readonly anonymization: AccountAnonymizationService,
    private readonly collectibleImages: CollectibleImagesService,
    @Inject(KV_STORE) private readonly kv: KeyValueStore,
  ) {}

  onModuleInit(): void {
    if (!isSchedulerEnabled()) {
      this.logger.warn(
        "scheduler is disabled (SCHEDULER_ENABLED=false): credit expiry / reconciliation / outbox dispatch will NOT run automatically",
      );
      return;
    }

    this.register(JOB_CREDIT_EXPIRY, cronExpression("EXPIRY_CRON", DEFAULT_EXPIRY_CRON), () =>
      this.runCreditExpiry(),
    );
    this.register(JOB_RECONCILIATION, cronExpression("RECONCILIATION_CRON", DEFAULT_RECONCILIATION_CRON), () =>
      this.runReconciliation(),
    );
    this.register(JOB_OUTBOX_DISPATCH, cronExpression("OUTBOX_CRON", DEFAULT_OUTBOX_CRON), () =>
      this.runOutboxDispatch(),
    );
    this.register(JOB_DATA_RETENTION, cronExpression("RETENTION_CRON", DEFAULT_RETENTION_CRON), () =>
      this.runDataRetention(),
    );
    this.register(JOB_EXPIRY_NOTICE, cronExpression("EXPIRY_NOTICE_CRON", DEFAULT_EXPIRY_NOTICE_CRON), () =>
      this.runExpiryNotice(),
    );
    this.register(
      JOB_LIABILITY_SNAPSHOT,
      cronExpression("LIABILITY_SNAPSHOT_CRON", DEFAULT_LIABILITY_SNAPSHOT_CRON),
      () => this.runLiabilitySnapshot(),
    );
    this.register(
      JOB_ACCOUNT_ANONYMIZATION,
      cronExpression("ANONYMIZATION_CRON", DEFAULT_ANONYMIZATION_CRON),
      () => this.runAccountAnonymization(),
    );
    this.register(
      JOB_COLLECTIBLE_IMAGE_INGEST,
      cronExpression("COLLECTIBLE_IMAGE_CRON", DEFAULT_COLLECTIBLE_IMAGE_CRON),
      () => this.runCollectibleImageIngest(),
    );
  }

  onModuleDestroy(): void {
    // 登録したジョブを明示的に止める。停止しないとNodeのタイマーが残り、
    // アプリ終了・テスト終了時にプロセスが落ちきらない。
    for (const name of this.registeredJobs) {
      try {
        this.registry.getCronJob(name).stop();
        this.registry.deleteCronJob(name);
      } catch {
        // 既に削除済み・未登録なら何もしない (二重停止を許容する)。
      }
    }
    this.registeredJobs.length = 0;
  }

  private register(name: string, expression: string, handler: () => Promise<unknown>): void {
    // cron式が不正だとCronJobのコンストラクタが投げる。1つのジョブの設定ミスで
    // API全体が起動不能になるのは避けたいため、ここで捕まえて他のジョブは登録する。
    try {
      const job = new CronJob(expression, () => {
        void handler();
      });
      this.registry.addCronJob(name, job);
      job.start();
      this.registeredJobs.push(name);
      this.logger.log(`scheduled job "${name}" registered (cron: ${expression})`);
    } catch (error) {
      this.logger.error(`failed to register scheduled job "${name}" (cron: ${expression})`, error as Error);
      captureException(error);
    }
  }

  /**
   * ジョブを排他実行する。APIを複数インスタンスで動かした場合に、同じ時刻に起動した
   * 全インスタンスが同じバッチを走らせるのを防ぐ。
   *
   * `incr`はRedis上で原子的で、最初の1件だけが1を返す (`packages/auth/src/kv-store.ts`)。
   * REDIS_URL未設定時はインメモリ実装になるが、その構成は単一インスタンス前提のため
   * プロセス内で排他できれば十分。
   *
   * @returns ロックを取得して実行したなら true、他インスタンス実行中で見送ったなら false
   */
  private async withLock(jobName: string, run: () => Promise<string>): Promise<boolean> {
    // メンテナンス中は走らせない。定期ジョブは失効・保持期間削除・Outbox送信・通知作成と
    // いずれも書き込みで、メンテナンスが更新を止める目的である以上、裏で書き続けては
    // 意味が無い (特にマイグレーション中のDBへの書き込みは壊し方が読みにくい)。
    // 見送った分は次回のスケジュールで拾われる。
    const mode = maintenanceMode();
    if (mode !== "off") {
      this.logger.log(`scheduled job "${jobName}" skipped: maintenance mode is ${mode}`);
      return false;
    }

    const key = `scheduler-lock:${jobName}`;
    const holders = await this.kv.incr(key, JOB_LOCK_TTL_SECONDS);
    if (holders !== 1) {
      this.logger.log(`scheduled job "${jobName}" skipped: another instance holds the lock`);
      return false;
    }

    const startedAt = Date.now();
    try {
      const summary = await run();
      this.logger.log(`scheduled job "${jobName}" finished in ${Date.now() - startedAt}ms: ${summary}`);
    } catch (error) {
      // ジョブの失敗でプロセスを落とさない (次回の実行機会を残す)。運用者が気づけるよう
      // Sentryへ送る (SENTRY_DSN未設定時はno-op)。
      this.logger.error(`scheduled job "${jobName}" failed`, error as Error);
      captureException(error);
    } finally {
      await this.kv.del(key).catch(() => undefined);
    }
    return true;
  }

  /** 有効期限が到来した獲得ORIを失効させる。手動実行(管理画面)と同じ処理を呼ぶ。 */
  async runCreditExpiry(): Promise<boolean> {
    return this.withLock(JOB_CREDIT_EXPIRY, async () => {
      const result = await this.rewardRules.runExpiryBatch();
      return `wallets_processed=${result.wallets_processed} total_expired_amount=${result.total_expired_amount}`;
    });
  }

  /** 残高整合性チェック。不一致時のSentry通知は`AdminService.reconcile()`側で行う。 */
  async runReconciliation(): Promise<boolean> {
    return this.withLock(JOB_RECONCILIATION, async () => {
      const result = await this.admin.reconcile();
      return `checked=${result.checkedWalletCount} mismatched=${result.mismatchedWalletCount}`;
    });
  }

  /**
   * 送信期日が来ているOutboxイベントを処理する。
   *
   * `processPendingEvents()`は1回あたり既定20件しか処理しないため、滞留分を捌けるよう
   * 空になるまで繰り返す (1回の実行が延々と続かないよう回数上限を設ける)。
   * 送信に失敗したイベントは指数バックオフで`available_at`が先送りされ、次の周回では
   * 対象外になるため、この繰り返しは必ず終わる。
   */
  async runOutboxDispatch(): Promise<boolean> {
    return this.withLock(JOB_OUTBOX_DISPATCH, async () => {
      let processed = 0;
      let failed = 0;
      let batches = 0;

      while (batches < OUTBOX_MAX_BATCHES_PER_TICK) {
        const result = await this.outbox.processPendingEvents();
        processed += result.processed;
        failed += result.failed;
        batches++;
        if (result.processed + result.failed === 0) break;
      }

      return `processed=${processed} failed=${failed} batches=${batches}`;
    });
  }

  /**
   * 取り込めていないカード画像を拾い直す (`docs/collectible-images.md`)。
   * ストレージが未設定の間は何もしない (件数0で終わる)。
   */
  async runCollectibleImageIngest(): Promise<boolean> {
    return this.withLock(JOB_COLLECTIBLE_IMAGE_INGEST, async () => {
      const result = await this.collectibleImages.retryPending(COLLECTIBLE_IMAGE_MAX_PER_TICK);
      return `attempted=${result.attempted} stored=${result.stored}`;
    });
  }

  /**
   * 失効間近のORIについて本人宛のお知らせを作成する (`ExpiryNoticeService`)。
   * 失効させる`JOB_CREDIT_EXPIRY`とは別ジョブにしている (予告は失効の数日前に出す必要があり、
   * 失効当日に走る処理とはタイミングが異なるため)。
   */
  async runExpiryNotice(): Promise<boolean> {
    return this.withLock(JOB_EXPIRY_NOTICE, async () => {
      const result = await this.expiryNotice.createExpiryNotices();
      return `accounts_notified=${result.accountsNotified} lots_marked=${result.lotsMarked}`;
    });
  }

  /**
   * 前月末のポイント負債スナップショットを記録する (`PointLiabilityService`)。
   * 会計が期首残高を全期間の取引を遡らずに出せるようにするためのもので、
   * 値は実行時刻に依存しない (月末以降の増減を差し引いて求める)。
   */
  async runLiabilitySnapshot(): Promise<boolean> {
    return this.withLock(JOB_LIABILITY_SNAPSHOT, async () => {
      const period = PointLiabilityService.previousPeriod();
      const result = await this.pointLiability.captureMonthEndSnapshot(period);
      return `period=${period} created=${result.created}`;
    });
  }

  /**
   * 猶予期間を過ぎた退会済みアカウントの個人情報を匿名化する
   * (`AccountAnonymizationService`)。Feature Flagが無効なら何もしない。
   */
  async runAccountAnonymization(): Promise<boolean> {
    return this.withLock(JOB_ACCOUNT_ANONYMIZATION, async () => {
      const result = await this.anonymization.anonymizeClosedAccounts();
      return result.skippedReason
        ? `skipped=${result.skippedReason}`
        : `accounts=${result.anonymizedAccounts} identities=${result.anonymizedIdentities}`;
    });
  }

  /** 保持期間を過ぎた行を削除する (`DataRetentionService` に対象と除外理由を記載)。 */
  async runDataRetention(): Promise<boolean> {
    return this.withLock(JOB_DATA_RETENTION, async () => {
      const result = await this.retention.purgeExpiredData();
      return `user_sessions=${result.userSessions} api_access_logs=${result.apiAccessLogs} outbox_sent=${result.sentOutboxEvents}`;
    });
  }
}
