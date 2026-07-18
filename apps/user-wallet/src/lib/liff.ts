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
// LINEへのログイン遷移を開始した目印。戻ってきた時点でこれが残っているのに
// ログイン済み判定にならない/IDトークンが取れない場合は、単なる「初回訪問」ではなく
// 実際の失敗なので、エラーとして画面に表示する (無言で選択画面に戻ることを防ぐ)。
const LOGIN_PENDING_KEY = "ove-liff-login-pending";

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
    window.sessionStorage.setItem(LOGIN_PENDING_KEY, "true");
    liff.login({ redirectUri: window.location.href });
    // login()はブラウザを遷移させるため、ここには到達しない。
    return;
  }
}

export interface LiffLoginResult {
  idToken: string;
  termsAccepted: boolean;
}

/**
 * LINEからのリダイレクト直後かどうかを判定する。
 *
 * - LIFF未設定: 常にnull (モック実装のまま)。
 * - 初回訪問 (ログイン開始前): isLoggedIn()がfalse、かつLOGIN_PENDING_KEYも無い
 *   → 通常の初回訪問としてnullを返す (エラーではない)。
 * - ログイン遷移後に戻ってきたが失敗: LOGIN_PENDING_KEYはあるのに
 *   isLoggedIn()がfalse、またはIDトークンが取得できない → 例外を投げて呼び出し元に
 *   エラー表示させる (これまでは無言でnullを返しており、失敗が画面に一切出ない
 *   不具合があった)。
 * - 成功: IDトークンとtermsAcceptedを返す。
 */
export async function getLiffIdTokenIfLoggedIn(): Promise<LiffLoginResult | null> {
  if (!LIFF_ID) return null;

  const wasPending = window.sessionStorage.getItem(LOGIN_PENDING_KEY) === "true";

  const liff = (await import("@line/liff")).default;
  await liff.init({ liffId: LIFF_ID });

  if (!liff.isLoggedIn()) {
    if (wasPending) {
      window.sessionStorage.removeItem(LOGIN_PENDING_KEY);
      throw new Error("LINEログインからの復帰後もログイン状態を確認できませんでした (liff.isLoggedIn()がfalse)");
    }
    return null;
  }

  const idToken = liff.getIDToken();
  if (!idToken) {
    if (wasPending) window.sessionStorage.removeItem(LOGIN_PENDING_KEY);
    throw new Error("LINEのIDトークンを取得できませんでした (liff.getIDToken()がnull)");
  }

  window.sessionStorage.removeItem(LOGIN_PENDING_KEY);
  const termsAccepted = window.sessionStorage.getItem(TERMS_ACCEPTED_KEY) === "true";
  window.sessionStorage.removeItem(TERMS_ACCEPTED_KEY);
  return { idToken, termsAccepted };
}
