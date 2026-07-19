import { Module } from "@nestjs/common";
import { MeController, ServiceAccountsController } from "./wallets.controller";
import { WalletsService } from "./wallets.service";
import { ReferralsModule } from "../referrals/referrals.module";

@Module({
  imports: [ReferralsModule],
  controllers: [MeController, ServiceAccountsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
