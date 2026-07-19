import { Controller, Get, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AccountsService } from "./accounts.service";
import { SessionAuthGuard, type AuthenticatedUserRequest } from "../common/session-auth.guard";
import { Req } from "@nestjs/common";

@ApiTags("accounts")
@Controller("api/v1/accounts")
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get("me")
  @UseGuards(SessionAuthGuard)
  async me(@Req() req: AuthenticatedUserRequest) {
    return req.account;
  }

  /** ログインデバイス一覧 (docs/login-devices.md参照)。 */
  @Get("me/sessions")
  @UseGuards(SessionAuthGuard)
  async listSessions(@Req() req: AuthenticatedUserRequest) {
    return this.accounts.listSessions(req.account.id, req.sessionId);
  }

  @Post("me/sessions/:sessionId/revoke")
  @UseGuards(SessionAuthGuard)
  async revokeSession(@Req() req: AuthenticatedUserRequest, @Param("sessionId") sessionId: string) {
    await this.accounts.revokeSession(req.account.id, sessionId);
    return { ok: true };
  }

  @Get(":oveAccountId")
  async getById(@Param("oveAccountId") oveAccountId: string) {
    const account = await this.accounts.getById(oveAccountId);
    if (!account) throw new NotFoundException("account not found");
    return account;
  }
}
