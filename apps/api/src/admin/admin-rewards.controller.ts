import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { AdminRewardRulesService } from "./admin-reward-rules.service";
import { CreateRewardRuleSchema, UpdateRewardRuleSchema } from "./dto/admin-rewards.dto";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { AdminAuthGuard } from "../common/admin-auth.guard";
import { Roles, RolesGuard } from "../common/roles.guard";

@ApiTags("admin-rewards")
@Controller("api/v1/admin")
export class AdminRewardsController {
  constructor(private readonly rewardRules: AdminRewardRulesService) {}

  /** 付与ルール管理 (指示書13章)。 */
  @Get("reward-rules")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR", "EVENT_OPERATOR", "AUDITOR")
  async listRewardRules() {
    return this.rewardRules.list();
  }

  /** ルール別発行量集計 (docs/admin-operations.md参照)。 */
  @Get("reward-rules/issuance-summary")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR", "EVENT_OPERATOR", "AUDITOR")
  async rewardRuleIssuanceSummary() {
    return this.rewardRules.getIssuanceSummary();
  }

  @Post("reward-rules")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN")
  async createRewardRule(
    @Body(new ZodValidationPipe(CreateRewardRuleSchema)) body: z.infer<typeof CreateRewardRuleSchema>,
  ) {
    return this.rewardRules.create(body);
  }

  @Patch("reward-rules/:ruleCode")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN")
  async updateRewardRule(
    @Param("ruleCode") ruleCode: string,
    @Body(new ZodValidationPipe(UpdateRewardRuleSchema)) body: z.infer<typeof UpdateRewardRuleSchema>,
  ) {
    return this.rewardRules.update(ruleCode, body);
  }

  /** OVE有効期限バッチの手動実行 (docs/credit-expiry.md参照)。 */
  @Post("expire-credits")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async runExpiryBatch() {
    return this.rewardRules.runExpiryBatch();
  }

  /** OVE有効期限バッチの失効予告レポート (docs/credit-expiry.md参照、書き込みなし)。 */
  @Get("expire-credits/preview")
  @UseGuards(AdminAuthGuard, RolesGuard)
  @Roles("SUPER_ADMIN", "OVE_OPERATOR")
  async previewExpiryBatch() {
    return this.rewardRules.previewExpiryBatch();
  }
}
