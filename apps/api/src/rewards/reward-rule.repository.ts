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

  /**
   * モジュール化後レビュー対応 P1-3: `reward_rules`行を`SELECT ... FOR UPDATE`で
   * ロックし、同一ルールへの並行付与を直列化する (`packages/ledger`の`lockWallet`と
   * 同じ設計)。呼び出し元の`$transaction`内で、上限判定より前に呼ぶこと。
   * 行が存在しない場合は何もロックせず終える (呼び出し元は従来通り「ルール未登録なら
   * 検証しない」という既存挙動のまま)。
   */
  async lockByRuleCode(ruleCode: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.$queryRaw`SELECT id FROM reward_rules WHERE rule_code = ${ruleCode} FOR UPDATE`;
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
