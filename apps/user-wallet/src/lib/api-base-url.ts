/**
 * APIサーバー (別ドメイン) のベースURL。
 *
 * 紹介URLの受け口 (`/invite`・`/r/{code}`) は、Cookieをこのドメインで発行させるために
 * APIサーバーへ直接リダイレクトする (`referral-cookie.ts`)。その組み立て元。
 *
 * `NEXT_PUBLIC_` 付きの環境変数はビルド時に値が埋め込まれるため、モジュールへ
 * 切り出しても各呼び出し箇所に直接書いた場合と同じ結果になる。
 */
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
