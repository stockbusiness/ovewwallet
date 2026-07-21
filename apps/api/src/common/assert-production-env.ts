/**
 * 次期改修指示書P0-6: `NODE_ENV=production`では以下を必須にし、未設定/不正値のまま
 * 起動を許さない (`AUTH_MODE`は`assert-auth-mode.ts`で既に検証済みのため、ここでは
 * それ以外の必須項目のみ扱う)。
 *
 * - REDIS_URL: 未設定だとOTP/nonce/jti/sessionがインスタンスごとにインメモリへ
 *   分断される (指示書5.1章、複数インスタンス構成での再利用防止が壊れる)。
 * - ENCRYPTION_KEY: 未設定だと`getEncryptionKey()`がdev-only-insecure-encryption-key
 *   フォールバックを使ってしまう (このアサーションにより本番ではその分岐へ到達しない)。
 * - LINE_CHANNEL_ID: LINEログインの本番実装(`LineIdTokenVerifier`)に必須。
 */
export function assertProductionEnvSafe(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;

  const missing: string[] = [];
  if (!env.REDIS_URL) missing.push("REDIS_URL");
  if (!env.ENCRYPTION_KEY) missing.push("ENCRYPTION_KEY");
  if (!env.LINE_CHANNEL_ID) missing.push("LINE_CHANNEL_ID");

  if (missing.length > 0) {
    throw new Error(
      `起動を中止しました: NODE_ENV=production では次の環境変数が必須です: ${missing.join(", ")} ` +
        "(次期改修指示書P0-6)。",
    );
  }
}
