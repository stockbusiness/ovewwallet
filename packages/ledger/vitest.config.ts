import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // 実PostgreSQLに対する統合テストのため、行ロック検証などは直列実行する
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
