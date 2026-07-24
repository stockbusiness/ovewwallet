import { Module } from "@nestjs/common";
import { RewardsController } from "./rewards.controller";
import { RewardsService } from "./rewards.service";
import { GrantRewardUseCase } from "./grant-reward.use-case";
import { GrantExternalServiceRewardUseCase } from "./grant-external-service-reward.use-case";
import { ServiceIntegrationRepository } from "./service-integration.repository";
import { ReverseRewardUseCase } from "./reverse-reward.use-case";
import { AccountsModule } from "../accounts/accounts.module";

@Module({
  imports: [AccountsModule],
  controllers: [RewardsController],
  providers: [
    RewardsService,
    GrantRewardUseCase,
    GrantExternalServiceRewardUseCase,
    ServiceIntegrationRepository,
    ReverseRewardUseCase,
  ],
  exports: [GrantRewardUseCase, ReverseRewardUseCase],
})
export class RewardsModule {}
