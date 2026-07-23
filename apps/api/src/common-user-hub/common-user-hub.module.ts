import { Module } from "@nestjs/common";
import { CommonUserHubClient } from "./common-user-hub.client";
import { IntegrationsModule } from "../integrations/integrations.module";

@Module({
  imports: [IntegrationsModule],
  providers: [CommonUserHubClient],
  exports: [CommonUserHubClient],
})
export class CommonUserHubModule {}
