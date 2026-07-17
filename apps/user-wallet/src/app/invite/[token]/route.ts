import { NextResponse, type NextRequest } from "next/server";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

/**
 * 代理店紹介URL (実装指示書 v1.0、Cookie発行方式の技術判断書)。
 * ここではCookieを発行せず、APIサーバー側 (別ドメイン) の紹介受付エンドポイントへ
 * 即時リダイレクトするだけにする。既存のセッションCookieと同じく、Cookie自体は
 * APIドメインで発行することでクロスドメイン構成でも後続のログインAPI呼び出しから
 * 参照できるようにするため。
 */
export async function GET(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const captureUrl = new URL("/api/v1/referrals/capture", API_BASE_URL);
  captureUrl.searchParams.set("token", token);

  return NextResponse.redirect(captureUrl, {
    status: 302,
    headers: {
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "no-store",
    },
  });
}
