/**
 * 定期実行の設定。
 *
 * Feature Flag (`common/feature-flags.ts`) と異なり **既定で有効** にしている。
 * これらは新機能ではなく「本来ずっと動いているべき運用処理」であり、既定OFFにすると
 * 本番で有効化を忘れたときに、失効が止まる・連携イベントが滞留するといった障害が
 * 無言で発生してしまうため (docs/runbooks/scheduled-jobs.md 参照)。
 * 止めたい場合のみ `SCHEDULER_ENABLED=false` を明示する。
 *
 * 自動テストは `.env.test` で無効化している (テスト中にcronが走ると、各テストが
 * 用意したデータを失効バッチが書き換えてしまい結果が不安定になるため)。
 */
export const DEFAULT_EXPIRY_CRON = "0 17 * * *"; // 02:00 JST
export const DEFAULT_RECONCILIATION_CRON = "0 20 * * *"; // 05:00 JST (日次バックアップ 03:00 JST の後)
export const DEFAULT_OUTBOX_CRON = "*/5 * * * *"; // 5分ごと

/** 1回のOutbox処理で回すバッチ数の上限。`processPendingEvents()`は既定20件/回。 */
export const OUTBOX_MAX_BATCHES_PER_TICK = 10;

/**
 * ジョブごとの排他ロックの保持時間。実行時間より十分長く、かつ異常終了時に
 * 次回実行までロックが残り続けない長さにする。
 */
export const JOB_LOCK_TTL_SECONDS = 15 * 60;

export function isSchedulerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SCHEDULER_ENABLED !== "false";
}

/** cron式の環境変数による上書き。未設定なら既定値を使う。 */
export function cronExpression(
  key: "EXPIRY_CRON" | "RECONCILIATION_CRON" | "OUTBOX_CRON",
  fallback: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env[key];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}
