/**
 * ブラウザからのアクセスを許可するオリジンの一覧。
 *
 * CORS設定 (`main.ts`) とCSRF対策 (`csrf-protection.middleware.ts`) の両方が
 * この同一の一覧を参照する。片方だけを緩めると「CORSでは弾かれるがCSRF検証は
 * 通過する」といった食い違いが生まれるため、必ずここを唯一の定義とする。
 *
 * `NODE_ENV=production` では `assertProductionEnvSafe()` が `APP_URL`/`ADMIN_URL`
 * の設定を必須にしているため、本番でこの配列が空になることはない。
 */
export function getAllowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return [env.APP_URL, env.ADMIN_URL].filter((v): v is string => Boolean(v));
}
