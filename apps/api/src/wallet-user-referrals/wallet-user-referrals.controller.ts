import { Controller, Get, Query, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { sha256Hex } from "@ove/auth";
import type { Request, Response } from "express";
import { appUrl } from "../common/app-url";
import { referralCookieOptions } from "../referrals/referral-cookie";
import { WalletUserReferralsService } from "./wallet-user-referrals.service";

export const WALLET_USER_REFERRAL_COOKIE_NAME = "wallet_user_referral_session";

/**
 * ウォレット利用者の紹介URL (`/r/{code}`) の受付。
 *
 * 代理店紹介 (`/api/v1/referrals/capture`) と同じ構成で、Cookieはこの
 * APIドメインで発行する (`referral-cookie.ts`。ウォレットドメインで発行すると
 * クロスドメイン構成で後続のログインAPIから参照できない)。
 *
 * Cookie名は代理店紹介と**分けている**。同じ名前にすると、代理店紹介リンクと
 * ウォレット紹介リンクを続けて開いた人のどちらか一方が静かに消え、
 * どちらが残ったのかも分からなくなるため。
 */
@ApiTags("wallet-user-referrals")
@Controller("api/v1/wallet-user-referrals")
export class WalletUserReferralsController {
  constructor(private readonly referrals: WalletUserReferralsService) {}

  @Get("capture")
  async capture(
    @Query("code") code: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const loginUrl = appUrl("/login");

    if (typeof code === "string" && code.trim() !== "") {
      const ip = req.ip;
      const userAgent = req.headers["user-agent"];
      const result = await this.referrals.capture({
        code,
        ipHash: ip ? sha256Hex(ip) : undefined,
        userAgentHash: userAgent ? sha256Hex(userAgent) : undefined,
      });
      if (result) {
        res.cookie(WALLET_USER_REFERRAL_COOKIE_NAME, result.cookieToken, {
          ...referralCookieOptions(req.hostname),
          expires: result.expiresAt,
        });
      }
    }

    // この時点のURLには紹介コードが残っているため、Referer経由の漏えいを防ぐ。
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");

    // オープンリダイレクト対策: リダイレクト先は環境変数由来の固定値のみ。
    res.redirect(302, loginUrl);
  }
}
