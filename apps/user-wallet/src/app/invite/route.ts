import { NextResponse, type NextRequest } from "next/server";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * 代理店システムが紹介URLへ載せてくるクエリパラメータ
 * (`docs/integration/AGENCY_POINT_AWARD.md` 1章)。ここに挙げたものだけを転送し、
 * 他のクエリは捨てる (URLは誰でも書き換えられる入力のため、素通しにしない)。
 */
const FORWARDED_PARAMS = [
  "token",
  "referral_token",
  "rt",
  "referral_session_key",
  "rs",
  "agency_id",
  "source",
] as const;

/**
 * 代理店紹介URLの受け口。パス形式 (`/invite/{token}`) に対する、クエリ形式の入口。
 *
 * `/invite/{token}` と同じく、ここではCookieを発行せずAPIサーバー側 (別ドメイン) の
 * 紹介受付エンドポイントへ即時リダイレクトする。Cookie自体をAPIドメインで発行しないと、
 * クロスドメイン構成では後続のログインAPI呼び出しから参照できないため。
 */
export async function GET(request: NextRequest) {
  const captureUrl = new URL("/api/v1/referrals/capture", API_BASE_URL);
  for (const name of FORWARDED_PARAMS) {
    const value = request.nextUrl.searchParams.get(name);
    if (value) captureUrl.searchParams.set(name, value);
  }

  return NextResponse.redirect(captureUrl, {
    status: 302,
    headers: {
      // この時点のURLにはまだ生の紹介トークンが載っているため、Referer経由の
      // 漏えいを防ぐ (開発ガイドライン5.4章)。
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    },
  });
}
