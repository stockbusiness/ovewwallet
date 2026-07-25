import { Module } from "@nestjs/common";
import { CollectiblesModule } from "../collectibles/collectibles.module";
import { ReferralsModule } from "../referrals/referrals.module";
import { MeController, ServiceAccountsController } from "./wallets.controller";
import { WalletsService } from "./wallets.service";

@Module({
  imports: [ReferralsModule, CollectiblesModule],
  controllers: [MeController, ServiceAccountsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
