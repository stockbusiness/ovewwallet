import { Controller, Get, Query, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { sha256Hex } from "@ove/auth";
import { ReferralsService } from "./referrals.service";

export const REFERRAL_SESSION_COOKIE_NAME = "referral_session";

// フロントエンド(Vercel)とAPI(Railway)が別ドメインの構成のため、既存のセッションCookie
// (packages/auth/src/session.ts) と同じくsameSite=noneで発行する。
const REFERRAL_COOKIE_OPTIONS = {
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

  @Get("capture")
  async capture(@Query("token") token: string | undefined, @Req() req: Request, @Res() res: Response) {
    const loginUrl = `${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/login`;

    if (token) {
      const ip = req.ip;
      const userAgent = req.headers["user-agent"];
      const result = await this.referrals.capture({
        rawToken: token,
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

    // オープンリダイレクト対策: リダイレクト先は環境変数由来の固定値のみとし、
    // クエリパラメータ等の外部入力からは絶対に組み立てない。
    res.redirect(302, loginUrl);
  }
}
