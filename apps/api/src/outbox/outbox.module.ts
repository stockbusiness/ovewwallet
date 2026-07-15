import { Module } from "@nestjs/common";
import { FeatureFlagsController, OutboxController } from "./outbox.controller";
import { OutboxService } from "./outbox.service";

@Module({
  controllers: [OutboxController, FeatureFlagsController],
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
