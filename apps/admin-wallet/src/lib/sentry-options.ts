/**
 * Sentry (エラートラッキング) の共通設定。
 *
 * `NEXT_PUBLIC_SENTRY_DSN` 未設定時は `init()` を呼ばない。API側
 * (`apps/api/src/common/sentry.ts`) と同じ方針で、監視の有無によってアプリの挙動が
 * 変わらないようにするため。DSNを払い出すまでは何も送信されない
 * (`docs/monitoring.md` 参照)。
 *
 * Sentryはブラウザ・サーバー・Edgeの3つの実行環境ごとにプロジェクト直下の設定ファイル
 * (`sentry.client.config.ts` など) を要求するため、設定の実体はここに集約して
 * 各ファイルから読み込む。user-wallet 側にも同じ内容のファイルがあるが、Sentryの
 * 設定ファイルはアプリのルート直下に置く必要があり、Nextアプリ同士でこの1ファイルを
 * 共有するために新しいワークスペース依存を足すのは割に合わないため別々に持つ。
 */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

export function isSentryEnabled(): boolean {
  return Boolean(SENTRY_DSN);
}

export function sentryOptions() {
  return {
    dsn: SENTRY_DSN,
    environment:
      process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    // API側と揃えてトレースは無効にする。レイテンシ計測が必要になったら
    // トラフィック規模を見てから判断する (docs/monitoring.md「対象外」参照)。
    tracesSampleRate: 0,
    // 管理画面は利用者の残高・個人情報を扱うため、既定でも個人情報
    // (IPアドレス・Cookie・リクエストボディ等) を送らない。
    sendDefaultPii: false,
  };
}
