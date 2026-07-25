import { defineConfig, devices } from "@playwright/test";

/**
 * リポジトリ内Playwright E2E自動化 (これまで手動実行のみだったブラウザ確認をコード化)。
 *
 * 前提: PostgreSQL/Redisが起動していること (DATABASE_URL/REDIS_URLは各アプリの
 * 環境変数に依存し、このテスト自体はDBマイグレーション適用等は行わない)。
 * 3アプリ (apps/api, apps/user-wallet, apps/admin-wallet) は `webServer` で
 * 自動起動する。既に起動済みの場合はそれを再利用する (`reuseExistingServer`)。
 */
const API_URL = process.env.API_URL ?? "http://localhost:4000";
const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const ADMIN_URL = process.env.ADMIN_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // 追加整合性対策P1-2 (CIへの追加) で判明: GitHub Actions runnerはこの開発コンテナより
  // CPU/メモリに余裕が無く、3アプリ+Postgres+Redisを同時に動かすと個々のリクエストが
  // ローカルより大幅に遅くなることがある (実際にLINEモックログインの応答待ちだけで
  // デフォルトの30秒テストタイムアウトを超えた実績あり)。CI実行時のみタイムアウトを
  // 引き上げ、ローカル開発時の速いフィードバックは変えない。
  timeout: process.env.CI ? 90_000 : 30_000,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // このリポジトリの開発コンテナには特定リビジョンのブラウザが事前インストールされて
        // おり (`PLAYWRIGHT_BROWSERS_PATH`)、`@playwright/test`の期待するリビジョンとは
        // 一致しないことがある。`npx playwright install`でのダウンロードに頼らず、
        // 環境変数で明示的に指定されたパスを使う (CI/他環境では未設定で通常通り解決される)。
        launchOptions: process.env.OVE_E2E_CHROMIUM_PATH
          ? { executablePath: process.env.OVE_E2E_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  webServer: [
    {
      command: "pnpm --filter @ove/api start",
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env.CI,
      cwd: "../..",
      timeout: 60_000,
      // ENABLE_WALLET_REFERRAL_TOKEN はこのAPIプロセスにだけ立てる (`.env.test` 本体には
      // 追加しない。apps/api の jest e2e (`outbox.test.ts`) が「未設定時は全フラグfalse」を
      // 検証しており、.env.test 側で有効化するとそちらが壊れるため)。
      env: { ENABLE_WALLET_REFERRAL_TOKEN: "true" },
    },
    {
      command: "pnpm --filter @ove/user-wallet start",
      url: APP_URL,
      reuseExistingServer: !process.env.CI,
      cwd: "../..",
      timeout: 60_000,
    },
    {
      command: "pnpm --filter @ove/admin-wallet start",
      url: ADMIN_URL,
      reuseExistingServer: !process.env.CI,
      cwd: "../..",
      timeout: 60_000,
    },
  ],
});
