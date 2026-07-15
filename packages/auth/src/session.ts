import { generateOpaqueToken, sha256Hex } from "./crypto";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日
export const SESSION_COOKIE_NAME = "ove_session";
export const ADMIN_SESSION_COOKIE_NAME = "ove_admin_session";

// フロントエンド(Vercel)とAPI(Railway)が別ドメインの構成では、sameSite=laxだと
// SPAのfetch()にセッションCookieが付与されずログイン状態を維持できない。
// noneにするとクロスサイト送信を許可できる(secure:trueは必須要件で既に満たす)。
// 将来、フロントエンド/APIを同一の親ドメイン配下に統一できればlaxに戻せる。
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "none" as const,
  path: "/",
};

export interface IssuedSession {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * OVE独自セッションを発行する。token はクライアントの Cookie に格納し、
 * tokenHash (SHA-256) のみ user_sessions テーブルへ保存する (平文保存禁止)。
 * tokenHash は検索キーとして使うため決定的ハッシュを用いる (scrypt は不可)。
 */
export function issueSession(ttlMs: number = SESSION_TTL_MS): IssuedSession {
  const token = generateOpaqueToken(32);
  return {
    token,
    tokenHash: sha256Hex(token),
    expiresAt: new Date(Date.now() + ttlMs),
  };
}

export function hashSessionToken(token: string): string {
  return sha256Hex(token);
}
