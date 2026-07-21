/**
 * `ENCRYPTION_KEY`の唯一の解決経路 (次期改修指示書P0-6「dev-only-insecure-encryption-key
 * フォールバックを本番経路から全廃」)。本番 (`NODE_ENV=production`) では
 * `assertProductionEnvSafe()` (`apps/api/src/common/assert-production-env.ts`) が起動時に
 * `ENCRYPTION_KEY`未設定を検知してプロセスを終了させるため、本番稼働中にこの関数へ
 * 到達した時点でENCRYPTION_KEYは必ず設定済みのはず。それでも未設定のまま到達した場合は
 * 復号鍵にダミー文字列を使わず即座に例外を投げる (fail-closed、多層防御)。
 * 開発・テスト環境のみ、設定が無ければ固定のダミー鍵にフォールバックする。
 */
export function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (key) return key;

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ENCRYPTION_KEY is not set. Refusing to use an insecure fallback key in production (次期改修指示書P0-6)。",
    );
  }
  return "dev-only-insecure-encryption-key";
}
