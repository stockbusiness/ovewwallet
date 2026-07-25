import { Module } from "@nestjs/common";
import { FeatureFlagsController, OutboxController } from "./outbox.controller";
import { OutboxService } from "./outbox.service";
import { OutboxRepository } from "./outbox.repository";

@Module({
  controllers: [OutboxController, FeatureFlagsController],
  providers: [OutboxService, OutboxRepository],
  exports: [OutboxService],
})
export class OutboxModule {}
