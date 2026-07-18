/**
 * LINEログイン本番実装 (LIFF SDK)。`NEXT_PUBLIC_LINE_LIFF_ID` が未設定の環境
 * (ローカル開発・CI・Playwright等) では一切呼び出されず、`login/page.tsx`は
 * 従来通りの疑似ID直接送信のモック実装を使う (`apps/api`側の`AUTH_MODE`と対になる
 * フロントエンド側の切り替え)。
 *
 * LIFFの`login()`はページ全体をLINEのログイン画面へ遷移させ、認証後に同じURLへ
 * 戻ってくる方式のため、状態はsessionStorageではなく`redirectUri`のクエリ
 * パラメータで引き継ぐ。実チャネルでの結合試験(2026-07-18)で、モバイルブラウザが
 * LINEアプリへの切り替えを挟むとsessionStorageが失われるケースを確認したため
 * (Safari/Chromeいずれでも再現)、ブラウザの一時記憶に依存しないこの方式に変更した。
 */
const LIFF_ID = process.env.NEXT_PUBLIC_LINE_LIFF_ID;
const PENDING_PARAM = "ove_liff_pending";
const TERMS_PARAM = "ove_liff_terms";

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
    const redirectUrl = new URL(window.location.href);
    redirectUrl.searchParams.set(PENDING_PARAM, "1");
    redirectUrl.searchParams.set(TERMS_PARAM, termsAccepted ? "1" : "0");
    liff.login({ redirectUri: redirectUrl.toString() });
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
 * - 初回訪問 (ログイン開始前): URLに`ove_liff_pending`が無い → 通常の初回訪問として
 *   nullを返す (エラーではない)。
 * - ログイン遷移後に戻ってきたが失敗: `ove_liff_pending=1`が付いているのに
 *   `liff.isLoggedIn()`がfalse、またはIDトークンが取得できない → 例外を投げて
 *   呼び出し元にエラー表示させる。
 * - 成功: IDトークンとtermsAcceptedを返す。
 */
export async function getLiffIdTokenIfLoggedIn(): Promise<LiffLoginResult | null> {
  if (!LIFF_ID) return null;

  const currentUrl = new URL(window.location.href);
  const wasPending = currentUrl.searchParams.get(PENDING_PARAM) === "1";
  const termsAccepted = currentUrl.searchParams.get(TERMS_PARAM) === "1";

  const liff = (await import("@line/liff")).default;
  await liff.init({ liffId: LIFF_ID });

  if (!liff.isLoggedIn()) {
    if (wasPending) {
      throw new Error("LINEログインからの復帰後もログイン状態を確認できませんでした (liff.isLoggedIn()がfalse)");
    }
    return null;
  }

  const idToken = liff.getIDToken();
  if (!idToken) {
    if (wasPending) {
      throw new Error("LINEのIDトークンを取得できませんでした (liff.getIDToken()がnull)");
    }
    return null;
  }

  return { idToken, termsAccepted };
}
