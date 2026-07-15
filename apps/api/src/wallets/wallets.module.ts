import { Module } from "@nestjs/common";
import { MeController, ServiceAccountsController } from "./wallets.controller";
import { WalletsService } from "./wallets.service";

@Module({
  controllers: [MeController, ServiceAccountsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
