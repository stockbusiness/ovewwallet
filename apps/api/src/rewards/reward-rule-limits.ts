import { BadRequestException } from "@nestjs/common";
import type { Prisma, PrismaClient, RewardRule, TransactionType } from "@ove/database";

export interface EnforceRewardRuleLimitsParams {
  ruleCode: string;
  walletId: string;
  transactionType: TransactionType;
  eventId: string;
  amount: bigint;
  /** monthly/global集計を`transactionType`だけでなくこの条件でも絞り込む (例: 商品コード
   * 単位)。複数の`rule_code`が同一`transactionType`を共有する場合 (`COMMON_EVENT_REWARD`
   * 等) に、他ルールの発行量が混ざらないようにするため。省略時は従来通り`transactionType`
   * のみで集計する (`RewardsService.grant`の既存挙動を変えない)。 */
  extraWhere?: Prisma.OveTransactionWhereInput;
}

/**
 * `reward_rules`の各種上限 (有効期間・ユーザー単位・イベント単位・月次件数/金額・
 * 累計金額) を検証する。`RewardsService.grant` (外部サービスAPI経由) と
 * `CommonEventHandlersService.handleRewardGranted` (共通イベントInbox経由、
 * 次期改修指示書P0-4) の両方から共有する。
 *
 * ルールが未登録、または`status`がACTIVEでない場合は何も検証せず素通りさせる
 * (`docs/external-api.md`の既存の運用方針: 運用担当者がルールを登録するまでは
 * ServiceIntegration側の上限のみ有効、という前提を維持する)。
 */
export async function enforceRewardRuleLimits(
  db: PrismaClient,
  params: EnforceRewardRuleLimitsParams,
): Promise<RewardRule | null> {
  const { ruleCode, walletId, transactionType, eventId, amount, extraWhere } = params;
  const rule = await db.rewardRule.findUnique({ where: { ruleCode } });
  if (!rule || rule.status !== "ACTIVE") return rule;

  const now = new Date();
  if (rule.startsAt && now < rule.startsAt) {
    throw new BadRequestException(`reward rule ${ruleCode} has not started yet`);
  }
  if (rule.endsAt && now > rule.endsAt) {
    throw new BadRequestException(`reward rule ${ruleCode} has already ended`);
  }

  if (rule.perUserLimit) {
    const count = await db.oveTransaction.count({
      where: { walletId, transactionType, status: "COMPLETED", ...extraWhere },
    });
    if (count >= rule.perUserLimit) {
      throw new BadRequestException(`per_user_limit (${rule.perUserLimit}) already reached for ${ruleCode}`);
    }
  }

  if (rule.perEventLimit) {
    const count = await db.oveTransaction.count({
      where: { walletId, transactionType, sourceReferenceId: eventId, status: "COMPLETED", ...extraWhere },
    });
    if (count >= rule.perEventLimit) {
      throw new BadRequestException(`per_event_limit (${rule.perEventLimit}) already reached for ${ruleCode}`);
    }
  }

  // monthly_count_limit / monthly_amount_limit はルール単位 (キャンペーン全体) の
  // 月間上限であり、per_user_limit (ユーザー単位) とは異なりウォレットを絞らず全体で集計する。
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  if (rule.monthlyCountLimit) {
    const count = await db.oveTransaction.count({
      where: { transactionType, status: "COMPLETED", occurredAt: { gte: monthStart }, ...extraWhere },
    });
    if (count >= rule.monthlyCountLimit) {
      throw new BadRequestException(`monthly_count_limit (${rule.monthlyCountLimit}) already reached for ${ruleCode}`);
    }
  }

  if (rule.monthlyAmountLimit) {
    const sum = await db.oveTransaction.aggregate({
      where: { transactionType, status: "COMPLETED", occurredAt: { gte: monthStart }, ...extraWhere },
      _sum: { amount: true },
    });
    const grantedThisMonth = sum._sum.amount ?? 0n;
    if (grantedThisMonth + amount > rule.monthlyAmountLimit) {
      throw new BadRequestException(`monthly_amount_limit (${rule.monthlyAmountLimit.toString()}) exceeded for ${ruleCode}`);
    }
  }

  if (rule.globalAmountLimit) {
    const sum = await db.oveTransaction.aggregate({
      where: { transactionType, status: "COMPLETED", ...extraWhere },
      _sum: { amount: true },
    });
    const grantedGlobally = sum._sum.amount ?? 0n;
    if (grantedGlobally + amount > rule.globalAmountLimit) {
      throw new BadRequestException(`global_amount_limit (${rule.globalAmountLimit.toString()}) exceeded for ${ruleCode}`);
    }
  }

  return rule;
}
