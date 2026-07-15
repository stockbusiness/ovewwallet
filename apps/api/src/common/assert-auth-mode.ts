/**
 * 開発ガイドライン12.2章: LINEログイン・戦国パスポートSSOは本番実装が未接続の間、
 * モック実装 (`MockLineAuthVerifier` 等) のみで動作する。本番環境で誤ってモック認証の
 * ままデプロイされることを防ぐため、`NODE_ENV=production` では `AUTH_MODE=production` の
 * 明示的な設定を必須とし、それ以外は起動そのものを失敗させる。
 */
export function assertAuthModeSafeForProduction(env: NodeJS.ProcessEnv = process.env): void {
  const nodeEnv = env.NODE_ENV;
  const authMode = env.AUTH_MODE ?? "mock";

  if (nodeEnv === "production" && authMode !== "production") {
    throw new Error(
      "起動を中止しました: NODE_ENV=production では AUTH_MODE=production の明示的な設定が必須です。" +
        " LINE/戦国パスポートSSOの本番実装が接続されるまでは、本番環境を起動できません" +
        " (開発ガイドライン12.2章)。",
    );
  }
}
