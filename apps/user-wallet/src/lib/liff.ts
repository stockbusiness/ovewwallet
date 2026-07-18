/**
 * LINEログイン本番実装 (LIFF SDK)。`NEXT_PUBLIC_LINE_LIFF_ID` が未設定の環境
 * (ローカル開発・CI・Playwright等) では一切呼び出されず、`login/page.tsx`は
 * 従来通りの疑似ID直接送信のモック実装を使う (`apps/api`側の`AUTH_MODE`と対になる
 * フロントエンド側の切り替え)。
 *
 * LIFFの`login()`はページ全体をLINEのログイン画面へ遷移させ、認証後に同じURLへ
 * 戻ってくる方式のため、状態はReactのstateではなくsessionStorageで引き継ぐ。
 */
const LIFF_ID = process.env.NEXT_PUBLIC_LINE_LIFF_ID;
const TERMS_ACCEPTED_KEY = "ove-liff-terms-accepted";

export function isLiffConfigured(): boolean {
  return Boolean(LIFF_ID);
}

/**
 * LIFFを初期化し、未ログインならLINEのログイン画面へ遷移する (呼び出し元には戻らない)。
 * 既にログイン済み(=LINEからのリダイレクト直後)の場合のみ通常通り関数が返る。
 */
export async function ensureLiffLogin(termsAccepted: boolean): Promise<void> {
  if (!LIFF_ID) throw new Error("LIFF is not configured (NEXT_PUBLIC_LINE_LIFF_ID is unset)");

  const liff = (await import("@line/liff")).default;
  await liff.init({ liffId: LIFF_ID });

  if (!liff.isLoggedIn()) {
    window.sessionStorage.setItem(TERMS_ACCEPTED_KEY, termsAccepted ? "true" : "false");
    liff.login({ redirectUri: window.location.href });
    // login()はブラウザを遷移させるため、ここには到達しない。
    return;
  }
}

/** LINEからのリダイレクト直後かどうかの判定に使う。 */
export async function getLiffIdTokenIfLoggedIn(): Promise<{ idToken: string; termsAccepted: boolean } | null> {
  if (!LIFF_ID) return null;

  const liff = (await import("@line/liff")).default;
  await liff.init({ liffId: LIFF_ID });
  if (!liff.isLoggedIn()) return null;

  const idToken = liff.getIDToken();
  if (!idToken) return null;

  const termsAccepted = window.sessionStorage.getItem(TERMS_ACCEPTED_KEY) === "true";
  window.sessionStorage.removeItem(TERMS_ACCEPTED_KEY);
  return { idToken, termsAccepted };
}
