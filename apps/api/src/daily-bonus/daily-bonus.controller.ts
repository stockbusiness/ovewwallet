import { Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { DailyBonusService } from "./daily-bonus.service";
import { SessionAuthGuard, type AuthenticatedUserRequest } from "../common/session-auth.guard";

/** 継続ログイン(デイリー)ボーナス (docs/daily-login-bonus.md参照)。 */
@ApiTags("me")
@Controller("api/v1/me/daily-bonus")
export class DailyBonusController {
  constructor(private readonly dailyBonus: DailyBonusService) {}

  @Get("status")
  @UseGuards(SessionAuthGuard)
  async status(@Req() req: AuthenticatedUserRequest) {
    return this.dailyBonus.getStatus(req.account.id);
  }

  @Post("claim")
  @UseGuards(SessionAuthGuard)
  async claim(@Req() req: AuthenticatedUserRequest) {
    return this.dailyBonus.claim(req.account.id);
  }

  @Get("history")
  @UseGuards(SessionAuthGuard)
  async history(@Req() req: AuthenticatedUserRequest) {
    return this.dailyBonus.getHistory(req.account.id);
  }
}
