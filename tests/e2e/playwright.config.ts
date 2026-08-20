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
// NFTカードClaim導線実装指示書のE2E用。戦国マーケットClaim APIを模したローカル
// サーバー (support/fake-market-server.mjs)。
const FAKE_MARKET_URL = process.env.FAKE_MARKET_URL ?? "http://127.0.0.1:4900";

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
      command: "node support/fake-market-server.mjs",
      url: `${FAKE_MARKET_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 10_000,
      env: { FAKE_MARKET_PORT: new URL(FAKE_MARKET_URL).port },
    },
    {
      command: "pnpm --filter @ove/api start",
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env.CI,
      cwd: "../..",
      timeout: 60_000,
      // ENABLE_WALLET_REFERRAL_TOKEN/ENABLE_DIGITAL_COLLECTION はこのAPIプロセスにだけ立てる
      // (`.env.test` 本体には追加しない。apps/api の jest e2e (`outbox.test.ts`) が
      // 「未設定時は全フラグfalse」を検証しており、.env.test 側で有効化するとそちらが壊れるため)。
      // COLLECTIBLE_IMAGE_ALLOWED_HOSTS (次期改修指示書P0-1のPR#2最終修正 P1-2):
      // Playwrightのカード投入ヘルパー(support/seed.ts)がpicsum.photosの画像URLを使うため、
      // Next.js Image Optimizerのremote patterns (apps/*/next.config.mjs) が同じホストを
      // 許可するようapps/api・apps/user-wallet・apps/admin-walletの3プロセス全てに揃える。
      env: {
        ENABLE_WALLET_REFERRAL_TOKEN: "true",
        // PR-W1: wallet-referrals.spec.tsが旧登録特典(3,000 OVE PENDING)の管理画面表示を
        // 検証しているため、既存挙動の回帰確認として明示的にONにする。
        ENABLE_LEGACY_REFERRAL_SIGNUP_BONUS: "true",
        ENABLE_DIGITAL_COLLECTION: "true",
        COLLECTIBLE_IMAGE_ALLOWED_HOSTS: "picsum.photos",
        // NFTカードClaim導線実装指示書。fake-market-server.mjs (下のwebServerで起動) を
        // 戦国マーケットのClaim APIとして扱う。
        ENABLE_COLLECTIBLE_CLAIM_FLOW: "true",
        SENGOKU_MARKET_CLAIM_BASE_URL: FAKE_MARKET_URL,
        SENGOKU_MARKET_CLAIM_KEY_ID: "e2e-claim-key",
        SENGOKU_MARKET_CLAIM_HMAC_SECRET: "e2e-claim-secret",
      },
    },
    {
      command: "pnpm --filter @ove/user-wallet start",
      url: APP_URL,
      reuseExistingServer: !process.env.CI,
      cwd: "../..",
      timeout: 60_000,
      env: { COLLECTIBLE_IMAGE_ALLOWED_HOSTS: "picsum.photos" },
    },
    {
      command: "pnpm --filter @ove/admin-wallet start",
      url: ADMIN_URL,
      reuseExistingServer: !process.env.CI,
      cwd: "../..",
      timeout: 60_000,
      env: { COLLECTIBLE_IMAGE_ALLOWED_HOSTS: "picsum.photos" },
    },
  ],
});
