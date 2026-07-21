import { Module } from "@nestjs/common";
import { AccountsController } from "./accounts.controller";
import { AccountsService } from "./accounts.service";
import { CommonUserHubModule } from "../common-user-hub/common-user-hub.module";
import { ReferralsModule } from "../referrals/referrals.module";

@Module({
  imports: [CommonUserHubModule, ReferralsModule],
  controllers: [AccountsController],
  providers: [AccountsService],
  exports: [AccountsService],
})
export class AccountsModule {}
