/**
 * ウォレット (user-wallet) の公開URL。
 *
 * ログイン画面へのリダイレクト先や共有URLは、**環境変数由来の固定値だけ**から
 * 組み立てる。リクエストのホスト名やクエリパラメータを混ぜるとオープンリダイレクト
 * になるため (`referrals.controller.ts`・`wallet-user-referrals.controller.ts`)。
 *
 * `NODE_ENV=production` では `assertProductionEnvSafe()` が `APP_URL` の未設定を
 * 起動時に弾くので、既定値はローカル開発のためだけのもの。
 */
export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
}

/** `appBaseUrl()` の配下のパス。`path`は先頭スラッシュ有無どちらでもよい。 */
export function appUrl(path: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${appBaseUrl(env)}/${path.replace(/^\//, "")}`;
}
