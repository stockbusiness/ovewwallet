import { Module } from "@nestjs/common";
import { AccountResolutionModule } from "../accounts/account-resolution.module";
import { CollectiblesModule } from "../collectibles/collectibles.module";
import { ReferralsModule } from "../referrals/referrals.module";
import { WalletUserReferralsModule } from "../wallet-user-referrals/wallet-user-referrals.module";
import { CLOCK, SystemClock } from "./clock";
import { MeController, ServiceAccountsController } from "./wallets.controller";
import { WalletsService } from "./wallets.service";

@Module({
  imports: [ReferralsModule, WalletUserReferralsModule, CollectiblesModule, AccountResolutionModule],
  controllers: [MeController, ServiceAccountsController],
  providers: [WalletsService, { provide: CLOCK, useClass: SystemClock }],
  exports: [WalletsService],
})
export class WalletsModule {}
