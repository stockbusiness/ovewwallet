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
export const DEFAULT_RETENTION_CRON = "30 19 * * *"; // 04:30 JST (バックアップ後・整合性チェック前)

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
  key: "EXPIRY_CRON" | "RECONCILIATION_CRON" | "OUTBOX_CRON" | "RETENTION_CRON",
  fallback: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env[key];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

// ── データ保持 (data-retention.service.ts) ─────────────────────────────
// 既定値は「調査に必要な期間は残しつつ、無限に増やさない」ことを狙った暫定値。
// 法令・社内規程で保持期間が定まったら環境変数で上書きする。
// 監査ログと取引はDBトリガーで削除できず、この設定の対象外 (長期保管が前提)。

/** 有効期限切れセッションを、期限切れ後どれだけ残すか。 */
export const USER_SESSION_RETENTION_DAYS = 90;
/** 外部APIアクセスログをどれだけ残すか。 */
export const API_ACCESS_LOG_RETENTION_DAYS = 180;
/** 送信済み(SENT)のOutboxイベントをどれだけ残すか。 */
export const OUTBOX_SENT_RETENTION_DAYS = 90;

/** 1度に削除する件数。長時間のロックを避けるため小さめに分割する。 */
export const RETENTION_CHUNK_SIZE = 1000;
/** 1回の実行で1テーブルあたり処理する最大チャンク数。超過分は次回へ持ち越す。 */
export const RETENTION_MAX_CHUNKS_PER_TABLE = 20;

export type RetentionDaysKey =
  | "USER_SESSION_RETENTION_DAYS"
  | "API_ACCESS_LOG_RETENTION_DAYS"
  | "OUTBOX_SENT_RETENTION_DAYS";

/**
 * 保持日数の環境変数による上書き。正の整数として解釈できない値は既定値を使う
 * (設定ミスで保持期間が0日になり、必要なデータまで消えるのを避けるため)。
 */
export function retentionDays(
  key: RetentionDaysKey,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const parsed = Number(env[key]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
