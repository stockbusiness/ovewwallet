import { Module } from "@nestjs/common";
import { CommonUserHubClient } from "./common-user-hub.client";

@Module({
  providers: [CommonUserHubClient],
  exports: [CommonUserHubClient],
})
export class CommonUserHubModule {}
