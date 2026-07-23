import { Inject, Injectable } from "@nestjs/common";
import type { Prisma, PrismaClient, RewardRule } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * リファクタリング指示書 Phase 8「DBアクセス境界」。`enforceRewardRuleLimits`・
 * `RewardsService.listPublicRules`・`AdminRewardRulesService`が個別に行っていた
 * `RewardRule`へのPrismaアクセスを集約する。
 */
@Injectable()
export class RewardRuleRepository {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async findByRuleCode(ruleCode: string, client: Db = this.db): Promise<RewardRule | null> {
    return client.rewardRule.findUnique({ where: { ruleCode } });
  }

  async listAll(client: Db = this.db): Promise<RewardRule[]> {
    return client.rewardRule.findMany({ orderBy: { createdAt: "desc" } });
  }

  /** ウォレット画面「OVEを貯める」向け: 現在有効な (開始済み・未終了の) ACTIVEルールのみ。 */
  async listActive(now: Date, client: Db = this.db): Promise<RewardRule[]> {
    return client.rewardRule.findMany({
      where: {
        status: "ACTIVE",
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async create(data: Prisma.RewardRuleCreateInput, client: Db = this.db): Promise<RewardRule> {
    return client.rewardRule.create({ data });
  }

  async update(ruleCode: string, data: Prisma.RewardRuleUpdateInput, client: Db = this.db): Promise<RewardRule> {
    return client.rewardRule.update({ where: { ruleCode }, data });
  }
}
