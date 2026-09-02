import { NextResponse, type NextRequest } from "next/server";

const INVITE_PATH = "/invite";

/**
 * 代理店システムが紹介パラメータを載せる先を、登録URLのどこにしても拾えるようにする
 * (`docs/integration/AGENCY_POINT_AWARD.md` 1章)。連携先へ渡すのは `/invite` だが、
 * トップや `/login` に付けられた場合でも紹介が失われないよう、同じクエリのまま
 * `/invite` へ寄せる。`/invite` 自身は素通しする (無限リダイレクトを避ける)。
 */
export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  if (pathname === INVITE_PATH || pathname.startsWith(`${INVITE_PATH}/`)) {
    return NextResponse.next();
  }

  const hasReferralParam =
    searchParams.has("referral_token") || searchParams.has("rt");
  if (!hasReferralParam) return NextResponse.next();

  const target = request.nextUrl.clone();
  target.pathname = INVITE_PATH;
  return NextResponse.redirect(target, {
    status: 302,
    headers: {
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * 画像・静的ファイル・Next.jsの内部パスは対象外にする。紹介パラメータが付くのは
 * 利用者がブラウザで開くページだけなので、判定を走らせる必要がない。
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.).*)"],
};
