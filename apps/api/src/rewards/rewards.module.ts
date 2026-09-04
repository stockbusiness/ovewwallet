import { Module } from "@nestjs/common";
import { GrantExternalServiceRewardUseCase } from "./grant-external-service-reward.use-case";
import { GrantRewardWithServiceLimitsUseCase } from "./grant-reward-with-service-limits.use-case";
import { GrantRewardUseCase } from "./grant-reward.use-case";
import { ReverseRewardUseCase } from "./reverse-reward.use-case";
import { RewardsController } from "./rewards.controller";
import { RewardsService } from "./rewards.service";
import { ServiceIntegrationRepository } from "./service-integration.repository";

@Module({
  controllers: [RewardsController],
  providers: [
    RewardsService,
    GrantRewardUseCase,
    GrantExternalServiceRewardUseCase,
    GrantRewardWithServiceLimitsUseCase,
    ServiceIntegrationRepository,
    ReverseRewardUseCase,
  ],
  exports: [GrantRewardUseCase, GrantRewardWithServiceLimitsUseCase, ReverseRewardUseCase],
})
export class RewardsModule {}
