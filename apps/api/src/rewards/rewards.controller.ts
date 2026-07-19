import { Body, Controller, Get, Post, Req, UseGuards, UseInterceptors } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { RewardGrantRequestSchema, type RewardGrantRequest } from "@ove/shared-types";
import { RewardsService } from "./rewards.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ExternalApiAuthGuard, type AuthenticatedServiceRequest } from "../common/external-api-auth.guard";
import { SessionAuthGuard } from "../common/session-auth.guard";
import { ApiAccessLogInterceptor } from "../common/api-access-log.interceptor";

@ApiTags("rewards")
@Controller("api/v1/rewards")
export class RewardsController {
  constructor(private readonly rewards: RewardsService) {}

  /** POST /api/v1/rewards/grant (指示書11章) — 外部サービスAPI (HMAC認証必須)。 */
  @Post("grant")
  @UseGuards(ExternalApiAuthGuard)
  @UseInterceptors(ApiAccessLogInterceptor)
  async grant(
    @Body(new ZodValidationPipe(RewardGrantRequestSchema)) body: RewardGrantRequest,
    @Req() req: AuthenticatedServiceRequest,
  ) {
    return this.rewards.grant(body, req.serviceIntegration);
  }

  /** GET /api/v1/rewards/public — ウォレット画面「OVEを貯める」向け。公開安全なフィールドのみ返す。 */
  @Get("public")
  @UseGuards(SessionAuthGuard)
  async listPublic() {
    return this.rewards.listPublicRules();
  }
}
