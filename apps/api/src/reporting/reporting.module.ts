import { Module } from "@nestjs/common";
import { PointLiabilityController } from "./point-liability.controller";
import { PointLiabilityService } from "./point-liability.service";

/** 会計・監査向けのレポート (docs/point-liability.md)。 */
@Module({
  controllers: [PointLiabilityController],
  providers: [PointLiabilityService],
  exports: [PointLiabilityService],
})
export class ReportingModule {}
