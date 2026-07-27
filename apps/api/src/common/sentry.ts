import * as Sentry from "@sentry/node";

/**
 * エラートラッキング (Sentry) の初期化。`SENTRY_DSN` 未設定時は何もしない
 * (Feature Flag未設定時に既存動作を変えない方針と同様、監視の有無で
 * アプリの挙動自体は変わらない)。実際に有効化するにはSentryプロジェクトを
 * 作成しDSNを払い出す必要がある (`docs/monitoring.md` 参照)。
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0,
  });
}

/** `initSentry()` と同じ条件 (`SENTRY_DSN` 設定時のみ) で送信する。 */
export function captureException(exception: unknown): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureException(exception);
}

/**
 * 不足機能実装指示書PR-W04 §8.4「Outbox FAILED」「Reconciliation mismatch」の監視用。
 * 例外ではなく運用上の異常事態 (Dead Letter到達・残高不整合など) をSentryへ通知するために
 * `captureException`とは別に用意する。`SENTRY_DSN`未設定時はno-op (既存方針と同じ)。
 */
export function captureMessage(message: string, level: "warning" | "error" = "warning"): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.captureMessage(message, level);
}
