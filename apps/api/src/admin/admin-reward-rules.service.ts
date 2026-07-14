import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

export interface CreateRewardRuleParams {
  ruleCode: string;
  ruleName: string;
  sourceService: string;
  rewardAmount: number;
  displayName: string;
  description?: string;
  perUserLimit?: number;
  perEventLimit?: number;
  monthlyCountLimit?: number;
  monthlyAmountLimit?: number;
  globalAmountLimit?: number;
  startsAt?: string;
  endsAt?: string;
  approvalType?: string;
}

export interface UpdateRewardRuleParams {
  ruleName?: string;
  rewardAmount?: number;
  displayName?: string;
  description?: string;
  status?: string;
  perUserLimit?: number | null;
  perEventLimit?: number | null;
  monthlyCountLimit?: number | null;
  monthlyAmountLimit?: number | null;
  globalAmountLimit?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  approvalType?: string;
}

/**
 * 付与ルール管理 (指示書13章)。指示書9章の初期2ルール
 * (SENGOKU_REGISTRATION_BONUS / AIART_ATTENDANCE_REWARD) の上限・期間を運用しながら
 * 調整できるようにする。新規ルールも作成できるが、`rewards.service.ts` の
 * `RULE_CODE_BY_TRANSACTION_TYPE` に対応するtransaction_typeが登録されていない限り、
 * 外部APIからの付与では自動適用されない (既知の制約。docs/admin-operations.md 参照)。
 */
@Injectable()
export class AdminRewardRulesService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async list() {
    return this.db.rewardRule.findMany({ orderBy: { createdAt: "desc" } });
  }

  async create(params: CreateRewardRuleParams) {
    const existing = await this.db.rewardRule.findUnique({ where: { ruleCode: params.ruleCode } });
    if (existing) throw new ConflictException(`reward rule ${params.ruleCode} already exists`);

    return this.db.rewardRule.create({
      data: {
        id: generateId(),
        ruleCode: params.ruleCode,
        ruleName: params.ruleName,
        sourceService: params.sourceService as never,
        rewardAmount: params.rewardAmount,
        displayName: params.displayName,
        description: params.description,
        perUserLimit: params.perUserLimit,
        perEventLimit: params.perEventLimit,
        monthlyCountLimit: params.monthlyCountLimit,
        monthlyAmountLimit: params.monthlyAmountLimit,
        globalAmountLimit: params.globalAmountLimit,
        startsAt: params.startsAt ? new Date(params.startsAt) : undefined,
        endsAt: params.endsAt ? new Date(params.endsAt) : undefined,
        approvalType: (params.approvalType as never) ?? "AUTOMATIC",
        status: "ACTIVE",
      },
    });
  }

  async update(ruleCode: string, params: UpdateRewardRuleParams) {
    const existing = await this.db.rewardRule.findUnique({ where: { ruleCode } });
    if (!existing) throw new NotFoundException(`reward rule ${ruleCode} not found`);

    return this.db.rewardRule.update({
      where: { ruleCode },
      data: {
        ruleName: params.ruleName,
        rewardAmount: params.rewardAmount,
        displayName: params.displayName,
        description: params.description,
        status: params.status as never,
        perUserLimit: params.perUserLimit,
        perEventLimit: params.perEventLimit,
        monthlyCountLimit: params.monthlyCountLimit,
        monthlyAmountLimit: params.monthlyAmountLimit,
        globalAmountLimit: params.globalAmountLimit,
        startsAt: params.startsAt === undefined ? undefined : params.startsAt ? new Date(params.startsAt) : null,
        endsAt: params.endsAt === undefined ? undefined : params.endsAt ? new Date(params.endsAt) : null,
        approvalType: params.approvalType as never,
      },
    });
  }
}
