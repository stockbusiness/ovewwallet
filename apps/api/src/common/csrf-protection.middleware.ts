import type { NextFunction, Request, Response } from "express";
import { getAllowedOrigins } from "./allowed-origins";

/** 副作用を持たない (CSRFの対象にならない) メソッド。 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CORSのプリフライトが発生しない「単純リクエスト」のContent-Type。
 * HTMLフォームはこの3種類しか送信できないため、状態変更リクエストで
 * これらを拒否すると、フォーム自動送信によるCSRF経路そのものが塞がる。
 * (`application/json` は単純リクエストではないため必ずプリフライトが発生し、
 * オリジン許可リストによるCORS検査を受ける。)
 */
const SIMPLE_REQUEST_CONTENT_TYPES = [
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
];

function isSimpleRequestContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  // "text/plain; charset=utf-8" のようなパラメータ付きも判定対象にする。
  const mediaType = contentType.split(";")[0]!.trim().toLowerCase();
  return SIMPLE_REQUEST_CONTENT_TYPES.includes(mediaType);
}

function deny(res: Response, message: string): void {
  res.status(403).json({ statusCode: 403, error: "Forbidden", message });
}

/**
 * CSRF (クロスサイトリクエストフォージェリ) 対策。
 *
 * フロントエンド(Vercel)とAPI(Railway)が別ドメインである都合上、セッションCookieは
 * `sameSite: "none"` で発行せざるを得ない (`packages/auth/src/session.ts` 参照)。
 * このためブラウザはクロスサイトのPOSTにもセッションCookieを添付する。
 *
 * CORSはこの経路を防げない。CORSが保証するのは「レスポンスを読めないこと」であって
 * 「リクエストがサーバーに到達しないこと」ではなく、単純リクエスト
 * (フォーム送信) はプリフライトなしでハンドラまで到達し副作用を発生させてしまう。
 *
 * そこで多層で防御する:
 *
 * 1. `Origin`ヘッダ検証: 状態変更メソッドで`Origin`が付いている場合、許可リストに
 *    含まれていなければ拒否する。`Origin`はブラウザが強制付与し、スクリプトからは
 *    偽装も削除もできない (Forbidden header name) ため、ブラウザ起点のCSRFを確実に
 *    塞げる。`Origin`が無い場合は素通しする — サーバー間通信 (HMAC認証の外部API・
 *    共通イベント受信口) には`Origin`が付かないため。これらはCookieではなくHMAC署名で
 *    認証しており、そもそもCSRFの成立条件 (ブラウザによる資格情報の自動添付) を
 *    満たさない。
 * 2. 単純リクエストContent-Typeの拒否: 1をすり抜けたとしてもフォーム送信経路自体を
 *    塞ぐ。この2つは独立に効くため、片方が破られても防御が残る。
 *
 * 許可リストが空 (ローカル開発で`APP_URL`/`ADMIN_URL`未設定) の場合は1を適用しない。
 * 「何が正当なオリジンか」が定義されていない状態では判定できないため。本番では
 * `assertProductionEnvSafe()`が両者の設定を必須にしているのでこの分岐には入らない。
 */
export function csrfProtectionMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  if (isSimpleRequestContentType(req.headers["content-type"])) {
    deny(res, "この Content-Type は状態変更リクエストでは許可されていません (CSRF対策)。");
    return;
  }

  const origin = req.headers.origin;
  if (typeof origin === "string" && origin.length > 0) {
    const allowedOrigins = getAllowedOrigins();
    if (allowedOrigins.length > 0 && !allowedOrigins.includes(origin)) {
      deny(res, "許可されていないオリジンからのリクエストです (CSRF対策)。");
      return;
    }
  }

  next();
}
