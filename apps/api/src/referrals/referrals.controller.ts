import { Controller, Get, Query, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { sha256Hex } from "@ove/auth";
import { ReferralsService } from "./referrals.service";

export const REFERRAL_SESSION_COOKIE_NAME = "referral_session";

// フロントエンド(Vercel)とAPI(Railway)が別ドメインの構成のため、既存のセッションCookie
// (packages/auth/src/session.ts) と同じくsameSite=noneで発行する。clearCookie側でも
// 同じオプションを指定する必要があるため (指定が食い違うとブラウザが削除を無視しうる)、
// auth.controller.tsから参照できるようexportする。
export const REFERRAL_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "none" as const,
  path: "/",
};

/**
 * 代理店紹介URL (`/invite/{token}`) の受付 (実装指示書 v1.0、Cookie発行方式の技術判断書)。
 * ウォレット側の `/invite/{token}` はここへ即時リダイレクトするだけで、Cookie自体は
 * このAPIドメインで発行する (セッションCookieと同じ構成上の理由)。
 */
@ApiTags("referrals")
@Controller("api/v1/referrals")
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  /**
   * 紹介トークンは3通りの名前で来る。`token`は`/invite/{token}`からの従来の受け渡し、
   * `referral_token`/`rt`は代理店システムが登録URLへ直接付けてくるクエリ
   * (`docs/integration/AGENCY_POINT_AWARD.md` 1章)。同様に紹介セッションキーは
   * `referral_session_key`/`rs`のどちらでも来る。先に指定されたものを採用する。
   */
  @Get("capture")
  async capture(
    @Query("token") token: string | undefined,
    @Query("referral_token") referralToken: string | undefined,
    @Query("rt") rt: string | undefined,
    @Query("referral_session_key") referralSessionKey: string | undefined,
    @Query("rs") rs: string | undefined,
    @Query("agency_id") agencyId: string | undefined,
    @Query("source") source: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const loginUrl = `${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/login`;
    const rawToken = firstNonEmpty(token, referralToken, rt);

    if (rawToken) {
      const ip = req.ip;
      const userAgent = req.headers["user-agent"];
      const result = await this.referrals.capture({
        rawToken,
        referralSessionKey: firstNonEmpty(referralSessionKey, rs),
        agencyId: firstNonEmpty(agencyId),
        source: firstNonEmpty(source),
        ipHash: ip ? sha256Hex(ip) : undefined,
        userAgentHash: userAgent ? sha256Hex(userAgent) : undefined,
      });
      if (result) {
        res.cookie(REFERRAL_SESSION_COOKIE_NAME, result.cookieToken, {
          ...REFERRAL_COOKIE_OPTIONS,
          expires: result.expiresAt,
        });
      }
    }

    // このレスポンス時点ではリクエストURLにまだ生の紹介トークンがクエリパラメータとして
    // 残っているため、Refererヘッダー経由での漏えいを防ぐ (開発ガイドライン5.4章)。
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");

    // オープンリダイレクト対策: リダイレクト先は環境変数由来の固定値のみとし、
    // クエリパラメータ等の外部入力からは絶対に組み立てない。
    res.redirect(302, loginUrl);
  }
}

/**
 * クエリパラメータは同じ名前が複数回現れると配列で届く (`?rt=a&rt=b`)。
 * 想定外の形は無視し、意味のある最初の文字列だけを採用する。
 */
function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return undefined;
}
