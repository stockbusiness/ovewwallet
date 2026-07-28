/**
 * NFTカードClaim導線実装指示書5章。ログイン後にどこへ戻ってよいかを判定する
 * 共通関数。LINE・メールOTP・千ノ国パスポートSSOの全ログイン経路 (すべて
 * `/login`の同じ画面が処理する) がこの1つの関数だけを通す。
 *
 * Open Redirect対策として、絶対URL・スキーム付き文字列・`//`始まりの
 * プロトコル相対URLをすべて拒否し、さらに許可Prefix (`/claim/`) 以外への
 * 復帰も拒否する (Claim画面以外への任意遷移を許可する理由が現状ないため)。
 */
const MAX_RETURN_PATH_LENGTH = 200;
const ALLOWED_RETURN_PATH_PREFIXES = ["/claim/"];

export function sanitizeInternalReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.length > MAX_RETURN_PATH_LENGTH) return null;
  if (!value.startsWith("/")) return null;
  // "//evil.example" (プロトコル相対URL) や "/\evil.example" (一部ブラウザが
  // バックスラッシュをスラッシュ扱いする) を拒否する。
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  // スキーム付き文字列 ("javascript:" 等はそもそも"/"始まりではないため上のチェックで
  // 弾かれるが、"://"が含まれる文字列全般を念のため多層防御として拒否する)。
  if (value.includes("://")) return null;
  if (!ALLOWED_RETURN_PATH_PREFIXES.some((prefix) => value.startsWith(prefix))) return null;
  return value;
}
