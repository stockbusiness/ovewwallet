/**
 * LINEログイン本番実装 (LIFF SDK)。`NEXT_PUBLIC_LINE_LIFF_ID` が未設定の環境
 * (ローカル開発・CI・Playwright等) では一切呼び出されず、`login/page.tsx`は
 * 従来通りの疑似ID直接送信のモック実装を使う (`apps/api`側の`AUTH_MODE`と対になる
 * フロントエンド側の切り替え)。
 *
 * 実チャネルでの結合試験(2026-07-18)で、`liff.login({redirectUri})`にクエリ
 * パラメータ付きの独自URLを渡すと、LINE側とのトークン交換が失敗する(画面に
 * "unexpected error"と表示される)ことを確認した。LIFF SDKのソース
 * (`@liff/init`)を確認したところ、`redirectUri`はそのままOAuthの`redirect_uri`
 * として認可リクエスト・トークン交換の両方に使われる設計であり、登録済みの
 * Endpoint URL以外の(クエリパラメータ付き)値を渡すのはSDKの想定用途から外れる
 * と判断した。そのため`redirectUri`のカスタマイズ自体をやめ、独自の状態
 * (利用規約同意フラグ)は`localStorage`に持たせる方式に変更した。外部ブラウザ
 * (`liff.isInClient()`がfalse)ではLIFF SDK自身もPKCEの`code_verifier`を
 * `localStorage`に保存する設計になっており、ページ全体のリダイレクトを
 * またいで実際に読み出せていることを確認済み(トークン交換のリクエスト自体は
 * 発生している)ため、同じ仕組みに乗せるのが最も安全と判断した。
 */
const LIFF_ID = process.env.NEXT_PUBLIC_LINE_LIFF_ID;
const PENDING_KEY = "ove-liff-pending";
const TERMS_KEY = "ove-liff-terms";

export function isLiffConfigured(): boolean {
  return Boolean(LIFF_ID);
}

/**
 * LiffErrorはcodeプロパティを持つため、表示用にメッセージへ付記する
 * (次回以降の切り分けのため、原因を特定できるだけの情報を画面に残す)。
 */
function describeLiffError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as { code?: string }).code;
    return code ? `${err.message || "(no message)"} [code: ${code}]` : err.message;
  }
  return "LINEログインに失敗しました";
}

type Liff = (typeof import("@line/liff"))["default"];

const LIFF_INIT_TIMEOUT_MS = 10_000;

/**
 * `liff.init()`はLINEのサーバーへの通信(コンテキスト取得等)を含むため、
 * ネットワーク状況によっては応答が返らないまま無反応になりうる。実チャネルでの
 * 結合試験(2026-07-18)で、画面が「ログイン中...」のまま(エラー表示も無く)
 * 固まったまま戻らない事象を確認したため、一定時間で強制的にタイムアウトさせ、
 * 必ず何らかのエラーメッセージが表示されるようにする (原因の切り分けのためにも、
 * 無反応のまま固まるより明示的な失敗の方が良い)。
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * `liff.init()`は1ページ読み込みにつき1回のみ呼ばれることを想定した設計になっており
 * (LIFF SDK自身が「liff.init is not expected to be called more than once」と警告する)、
 * ページ読み込み時の`useEffect` (getLiffIdTokenIfLoggedIn) とボタンクリック時
 * (ensureLiffLogin) の両方から個別に呼んでいたことが原因で、2回目の初期化が
 * ハングし「ログイン中...」のまま固まる不具合を実チャネルで確認した(2026-07-18)。
 * そのため初期化を1回だけ行い、結果 (liffインスタンス) をこのモジュール内で
 * 使い回す。
 */
let liffInitPromise: Promise<Liff> | null = null;

async function getInitializedLiff(): Promise<Liff> {
  if (!LIFF_ID) throw new Error("LIFF is not configured (NEXT_PUBLIC_LINE_LIFF_ID is unset)");

  if (!liffInitPromise) {
    liffInitPromise = (async () => {
      const liff = (await import("@line/liff")).default;
      await withTimeout(
        liff.init({ liffId: LIFF_ID }),
        LIFF_INIT_TIMEOUT_MS,
        "LIFFの初期化がタイムアウトしました (LINEサーバーからの応答がありませんでした)",
      );
      return liff;
    })();
  }

  try {
    return await liffInitPromise;
  } catch (err) {
    // 初期化失敗時は次回の呼び出しでやり直せるようキャッシュをクリアする。
    liffInitPromise = null;
    throw err;
  }
}

export interface LiffLoginResult {
  idToken: string;
  termsAccepted: boolean;
}

const PENDING_SUBMIT_KEY = "ove-liff-pending-submit";

/**
 * IDトークンをAPIへ送信・`/wallet`へ遷移する前に、iOS特有のLIFF SDKの挙動
 * (`pageshow`イベントでの自動`location.reload()`、実チャネルでの結合試験
 * (2026-07-18)で確認)によってページがリロードされ、送信・遷移が完了しない
 * まま同じ処理が繰り返されるループが発生した。IDトークンを取得できた時点で
 * 即座にここへ保存しておくことで、リロードで中断された場合でも次の読み込み時に
 * `liff.init()`を再実行せず(=再びリロードのきっかけを作らず)直接送信を
 * やり直せるようにする。
 */
export function savePendingSubmission(result: LiffLoginResult): void {
  try {
    window.localStorage.setItem(PENDING_SUBMIT_KEY, JSON.stringify(result));
  } catch {
    // 保存できなくても致命的ではない (通常通りliff.init()からやり直すだけ)。
  }
}

export function getPendingSubmission(): LiffLoginResult | null {
  try {
    const raw = window.localStorage.getItem(PENDING_SUBMIT_KEY);
    return raw ? (JSON.parse(raw) as LiffLoginResult) : null;
  } catch {
    return null;
  }
}

export function clearPendingSubmission(): void {
  window.localStorage.removeItem(PENDING_SUBMIT_KEY);
  window.localStorage.removeItem(PENDING_SUBMIT_ATTEMPTS_KEY);
}

const PENDING_SUBMIT_ATTEMPTS_KEY = "ove-liff-pending-submit-attempts";
export const MAX_PENDING_SUBMIT_ATTEMPTS = 5;

/**
 * API送信が本当に(トークン失効等で)恒久的に失敗し続けるケースで、送信待ちの
 * IDトークンを無限に再送し続けることを防ぐための上限カウンタ。
 */
export function incrementPendingSubmitAttempts(): number {
  const raw = window.localStorage.getItem(PENDING_SUBMIT_ATTEMPTS_KEY);
  const count = (raw ? Number.parseInt(raw, 10) : 0) + 1;
  window.localStorage.setItem(PENDING_SUBMIT_ATTEMPTS_KEY, String(count));
  return count;
}

/**
 * LIFFを初期化し、LINEのログイン画面へ遷移する (呼び出し元には戻らない)。
 *
 * 既にLIFFのログイン状態(アクセストークン)が残っている場合でも、そのIDトークン
 * 自体は期限切れになっている可能性がある(実チャネルでの結合試験(2026-07-18)で、
 * 同じ端末で長時間・複数回テストを繰り返した際に「IdToken expired」でAPI側の
 * 検証が失敗する事象を確認した — LIFFの「ログイン済み」判定とIDトークン自体の
 * 有効期限は別物で、前者が有効でも後者が期限切れになりうる)。そのため、ボタンを
 * 押した時点で常に一度ログアウトしてから改めてLINEへ遷移し、必ず新しいIDトークンを
 * 取得し直す方式にしている。
 */
export async function ensureLiffLogin(termsAccepted: boolean): Promise<void> {
  let liff: Liff;
  try {
    liff = await getInitializedLiff();
  } catch (err) {
    throw new Error(describeLiffError(err));
  }

  const wasLoggedIn = liff.isLoggedIn();
  if (wasLoggedIn) {
    liff.logout();
  }

  window.localStorage.setItem(PENDING_KEY, "1");
  window.localStorage.setItem(TERMS_KEY, termsAccepted ? "1" : "0");
  liff.login();
  // login()はブラウザを遷移させるため、ここには到達しない。
}

/**
 * LINEからのリダイレクト直後かどうかを判定する。
 *
 * - LIFF未設定: 常にnull (モック実装のまま)。
 * - 初回訪問 (ログイン開始前): `localStorage`に`ove-liff-pending`が無い → 通常の
 *   初回訪問としてnullを返す (エラーではない)。
 * - ログイン遷移後に戻ってきたが失敗: `ove-liff-pending=1`が付いているのに
 *   `liff.isLoggedIn()`がfalse、またはIDトークンが取得できない → 例外を投げて
 *   呼び出し元にエラー表示させる。
 * - 成功: IDトークンとtermsAcceptedを返す。
 *
 * いずれの場合も`localStorage`のフラグは読み取り後すぐに消す
 * (次回以降の通常訪問が「復帰後」と誤認識されないようにするため)。
 */
export type LiffReturnAction =
  | { kind: "ignore" }
  | { kind: "error"; reason: "not-logged-in" | "no-id-token" }
  | { kind: "resume"; idToken: string; termsAccepted: boolean };

/**
 * LINEからの復帰処理をどう扱うかの判定。副作用を持たないので単体テストで固定する
 * (`liff.test.ts`)。
 *
 * **`wasPending` を必ず見ること。** `liff.login()` が張ったLINEのセッションは
 * ブラウザに残るため、`isLoggedIn()` だけで判断すると「ログイン開始を経ていない
 * ただの再読み込み」まで復帰と誤認する。そのとき同意フラグ (`TERMS_KEY`) は
 * 直前の復帰処理で読み捨てられており、`termsAccepted=false` のまま送信して
 * **新規アカウント作成が400で失敗する** (2026-09-04、紹介URLからの新規登録が
 * "terms of service agreement is required to create a new account" で止まった)。
 * さらにその値が `savePendingSubmission` で正しい同意付きの送信待ちを上書きするため、
 * 再試行しても復旧しなくなる。
 */
export function decideLiffReturn(state: {
  wasPending: boolean;
  termsAccepted: boolean;
  loggedIn: boolean;
  idToken: string | null;
}): LiffReturnAction {
  if (!state.wasPending) return { kind: "ignore" };
  if (!state.loggedIn) return { kind: "error", reason: "not-logged-in" };
  if (!state.idToken) return { kind: "error", reason: "no-id-token" };
  return { kind: "resume", idToken: state.idToken, termsAccepted: state.termsAccepted };
}

export async function getLiffIdTokenIfLoggedIn(): Promise<LiffLoginResult | null> {
  if (!LIFF_ID) return null;

  const wasPending = window.localStorage.getItem(PENDING_KEY) === "1";
  const termsAccepted = window.localStorage.getItem(TERMS_KEY) === "1";
  window.localStorage.removeItem(PENDING_KEY);
  window.localStorage.removeItem(TERMS_KEY);

  let liff: Liff;
  try {
    liff = await getInitializedLiff();
  } catch (err) {
    if (wasPending) throw new Error(describeLiffError(err));
    return null;
  }

  const loggedIn = liff.isLoggedIn();
  const idToken = loggedIn ? liff.getIDToken() : null;

  const action = decideLiffReturn({ wasPending, termsAccepted, loggedIn, idToken });
  if (action.kind === "ignore") {
    return null;
  }
  if (action.kind === "error") {
    throw new Error(
      action.reason === "not-logged-in"
        ? "LINEログインからの復帰後もログイン状態を確認できませんでした (liff.isLoggedIn()がfalse)"
        : "LINEのIDトークンを取得できませんでした (liff.getIDToken()がnull)",
    );
  }

  // 呼び出し元に返ってから保存するまでの一瞬の間にpageshowリロードが発生し、
  // 保存されないまま次のループに入ってしまう事象を確認したため(2026-07-18)、
  // 呼び出し元を経由せずこの場で即座に保存する。
  savePendingSubmission({ idToken: action.idToken, termsAccepted: action.termsAccepted });
  return { idToken: action.idToken, termsAccepted: action.termsAccepted };
}
