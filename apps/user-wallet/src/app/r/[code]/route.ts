import { NextResponse, type NextRequest } from "next/server";
import { API_BASE_URL } from "@/lib/api-base-url";

/**
 * ウォレット利用者の紹介URL (`docs/wallet-user-referral.md`)。
 *
 * 代理店紹介の `/invite/{token}` と同じく、ここではCookieを発行せずAPIサーバー側
 * (別ドメイン) の受付エンドポイントへ即時リダイレクトする。Cookieをウォレット
 * ドメインで発行すると、クロスドメイン構成では後続のログインAPI呼び出しから
 * 参照できないため (`referral-cookie.ts`)。
 *
 * パスを `/invite` と分けているのは、`middleware.ts` が `referral_token`/`rt` の
 * 付いたリクエストを全パスから `/invite` へ寄せるため。同じ入口に相乗りさせると、
 * ウォレット紹介が代理店紹介として扱われてしまう。
 */
export async function GET(request: NextRequest, context: { params: Promise<{ code: string }> }) {
  const { code } = await context.params;
  const captureUrl = new URL("/api/v1/wallet-user-referrals/capture", API_BASE_URL);
  captureUrl.searchParams.set("code", code);

  return NextResponse.redirect(captureUrl, {
    status: 302,
    headers: {
      // この時点のURLには紹介コードが載っているため、Referer経由の漏えいを防ぐ。
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    },
  });
}
