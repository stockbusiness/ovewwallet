/**
 * Next.js の instrumentation フック。実行環境に応じてサーバー/Edge用のSentry設定を
 * 読み込む (ブラウザ用は sentry.client.config.ts がバンドルへ自動で取り込まれる)。
 * Next.js 14 では next.config.mjs の `experimental.instrumentationHook` が必要。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}
