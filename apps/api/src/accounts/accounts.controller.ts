import { Controller, Get, NotFoundException, Param, UseGuards } from "@nestjs/common";
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

  @Get(":oveAccountId")
  async getById(@Param("oveAccountId") oveAccountId: string) {
    const account = await this.accounts.getById(oveAccountId);
    if (!account) throw new NotFoundException("account not found");
    return account;
  }
}
