/**
 * 追加整合性対策P1-2 (独立E2EのCI追加) で判明: GitHub Actions runnerはこの開発コンテナより
 * CPU/メモリに余裕が無く、3アプリ+Postgres+Redisを同時に動かすとページ遷移1つが
 * ローカルより大幅に遅くなることがある。CI実行時のみナビゲーション待機を長くし、
 * ローカル開発時の速いフィードバックは変えない。
 */
export const NAV_TIMEOUT = process.env.CI ? 30_000 : 15_000;
export const NAV_TIMEOUT_SHORT = process.env.CI ? 20_000 : 10_000;
