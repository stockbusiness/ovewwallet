/**
 * 利用できるログイン方法 (docs/login-methods.md)。
 *
 * 稼働開始時点で使えるのは**LINEログインだけ**。他は実装または接続が済んでいない。
 *
 * - **メールOTP**: コードを発行してKVに保存するところまでしか実装されておらず、
 *   **メール送信基盤が無い**。`NODE_ENV`が本番以外のときだけ応答にコードを含めて
 *   画面に出しているため動いて見えるが、本番ではコードが利用者に届かず誰もログイン
 *   できない (`AuthService.requestEmailOtp`)。
 * - **千ノ国パスポートSSO**: 正式SSO (RS256/JWKS) が未完成で、モック発行
 *   エンドポイントは本番で404になる (`auth.controller.ts` の `dev-issue`)。
 * - **代理店SSO**: `SENGOKU_AI_SSO_*` 未設定時は必ず検証に失敗するプレースホルダー値が
 *   入る (`AuthService`)。接続が済むまで使えない。
 *
 * 画面から隠すだけでなく**サーバー側でも拒否する**。画面の出し分けだけでは、
 * APIを直接叩けば動かない経路に入れてしまい、原因の分かりにくい失敗になるため。
 *
 * 有効化は環境変数で行う。実装・接続が済んだときにコード変更なしで開けられるように
 * するため (Feature Flagと同じく**既定は無効**、`docs/development-guardrails.md` 13章)。
 */
export const LOGIN_METHODS = ["line", "email", "sengoku_passport", "agency"] as const;

export type LoginMethod = (typeof LOGIN_METHODS)[number];

/**
 * 環境変数名。`ENABLE_LINE_LOGIN` だけは**既定で有効**にしている。
 * 唯一使えるログイン方法であり、設定漏れで誰もログインできなくなる方が害が大きいため。
 */
const ENV_KEY: Record<LoginMethod, string> = {
  line: "ENABLE_LINE_LOGIN",
  email: "ENABLE_EMAIL_LOGIN",
  sengoku_passport: "ENABLE_SENGOKU_PASSPORT_LOGIN",
  agency: "ENABLE_AGENCY_LOGIN",
};

export function isLoginMethodEnabled(
  method: LoginMethod,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = env[ENV_KEY[method]];
  // LINEのみ「明示的にfalseにしたときだけ無効」。他は「trueにしたときだけ有効」。
  if (method === "line") return value !== "false";
  return value === "true";
}

export type LoginMethodAvailability = Record<LoginMethod, boolean>;

/** ログイン画面が「どのボタンを出すか」を決めるために参照する。 */
export function availableLoginMethods(env: NodeJS.ProcessEnv = process.env): LoginMethodAvailability {
  return Object.fromEntries(
    LOGIN_METHODS.map((m) => [m, isLoginMethodEnabled(m, env)]),
  ) as LoginMethodAvailability;
}
