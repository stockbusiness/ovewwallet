import type { CookieOptions } from "express";

/**
 * 紹介セッションCookieの属性 (`docs/agency-integration.md`)。
 *
 * ## なぜドメインを付けるのか
 *
 * 紹介の受付 (`GET /api/v1/referrals/capture`) は、ブラウザがAPIドメイン
 * (`api.sennokuni-wallet.com`) へ**直接**リダイレクトされて実行される。一方その後の
 * ログインはウォレットドメイン (`sennokuni-wallet.com/api/...`) 宛で、Next.jsの
 * rewriteがサーバー側でAPIへ中継する (2026-07-18、iOSのITP対策)。
 *
 * `domain`を指定しないCookieは**発行元ホスト専用**になるため、capture が発行した
 * Cookieはログイン時にブラウザから送られず、**紹介URLから登録しても代理店に
 * 紐付かない**。しかも登録自体は成功して見えるので運用では気づけない
 * (2026-09-05、本番のSet-Cookieヘッダーで確認)。
 *
 * ログインのセッションCookieが同じ問題を起こしていないのは、そちらの応答が
 * rewriteを通ってウォレットドメインから返るため。captureだけがrewriteを経由せず
 * ブラウザを直接APIドメインへ飛ばしていた。
 *
 * ## 安全側の作り
 *
 * 共有ドメインは`APP_URL`から導出するが、**リクエストのホストがそのドメインの
 * 配下にあると確認できたときだけ**付ける。APIが別ドメイン (例: Railwayの既定
 * ホスト名) で受けている場合に無関係な`Domain`を指定すると、ブラウザはCookieを
 * **丸ごと拒否**し、今より悪い状態になるため。確認できないときは従来どおり
 * ホスト専用のCookieとして発行する。
 */
const BASE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: true,
  // フロントエンド(Vercel)とAPI(Railway)が別ホストの構成のため、既存のセッション
  // Cookie (packages/auth/src/session.ts) と同じくsameSite=noneで発行する。
  sameSite: "none",
  path: "/",
};

/** ローカル開発・IP直指定では共有の必要が無く、ブラウザも受け付けない。 */
function isShareableHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  // IPv4 / IPv6 リテラル
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.includes(":")) return false;
  // 少なくとも1つのドットが要る (単一ラベルのホストにDomainは付けられない)
  return host.includes(".");
}

/**
 * Cookieを共有させるドメイン。共有できないと判断したら undefined
 * (= 従来どおりホスト専用) を返す。
 */
export function referralCookieDomain(
  requestHostname: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!requestHostname) return undefined;

  let appHost: string;
  try {
    appHost = new URL(env.APP_URL ?? "").hostname;
  } catch {
    return undefined;
  }
  if (!isShareableHost(appHost)) return undefined;

  // 同じホストで受けているなら、そもそも共有の必要が無い。
  if (requestHostname === appHost) return undefined;

  // APIがウォレットドメインの配下にあると確認できたときだけ広げる。
  // (例: appHost=sennokuni-wallet.com, requestHostname=api.sennokuni-wallet.com)
  if (!requestHostname.endsWith(`.${appHost}`)) return undefined;

  return appHost;
}

/**
 * `res.cookie` / `res.clearCookie` の両方で使う。指定が食い違うとブラウザが削除を
 * 無視しうるため、必ず同じ関数から取ること。
 */
export function referralCookieOptions(
  requestHostname: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): CookieOptions {
  const domain = referralCookieDomain(requestHostname, env);
  return domain ? { ...BASE_OPTIONS, domain } : { ...BASE_OPTIONS };
}
