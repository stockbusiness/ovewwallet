import { Module } from "@nestjs/common";
import { DailyBonusController } from "./daily-bonus.controller";
import { DailyBonusService } from "./daily-bonus.service";

@Module({
  controllers: [DailyBonusController],
  providers: [DailyBonusService],
})
export class DailyBonusModule {}
