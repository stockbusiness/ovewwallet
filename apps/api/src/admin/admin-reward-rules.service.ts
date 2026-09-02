import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, type PrismaClient, type TransactionType } from "@ove/database";
import { expireDueCreditLots, previewExpiringCreditLots } from "@ove/ledger";
import { PRISMA } from "../common/prisma.module";
import { RULE_CODE_BY_TRANSACTION_TYPE } from "../rewards/rewards.service";
import { RewardRuleRepository } from "../rewards/reward-rule.repository";
import { InvalidLandingUrlError, normalizeLandingUrl } from "../rewards/landing-url";

/**
 * 案内先URLを検証して保存できる形にする。不正な値は400で返す
 * (管理画面の入力ミスであり、サーバー側の異常ではないため)。
 */
function toLandingUrl(input: string | null | undefined): string | null | undefined {
  if (input === undefined) return undefined;
  try {
    return normalizeLandingUrl(input);
  } catch (error) {
    if (error instanceof InvalidLandingUrlError) {
      throw new BadRequestException("案内先URLは https:// で始まる有効なURLを入力してください。");
    }
    throw error;
  }
}

/**
 * 監査ログに残す項目。金額・上限・有効期間など「いくら付与されるか」を決める値に絞る
 * (`updatedAt` のように毎回変わる値を入れると差分が読みにくくなるため)。
 * BigInt は JSON にできないので文字列にする。
 */
function auditSnapshot(rule: {
  ruleName: string;
  displayName: string;
  rewardAmount: bigint | number | string;
  perUserLimit: number | null;
  perEventLimit: number | null;
  monthlyCountLimit: number | null;
  monthlyAmountLimit: bigint | number | string | null;
  globalAmountLimit: bigint | number | string | null;
  expiryDays: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  status: string;
}): Record<string, string | number | null> {
  const str = (v: bigint | number | string | null) => (v === null ? null : String(v));
  return {
    ruleName: rule.ruleName,
    displayName: rule.displayName,
    rewardAmount: String(rule.rewardAmount),
    perUserLimit: rule.perUserLimit,
    perEventLimit: rule.perEventLimit,
    monthlyCountLimit: rule.monthlyCountLimit,
    monthlyAmountLimit: str(rule.monthlyAmountLimit),
    globalAmountLimit: str(rule.globalAmountLimit),
    expiryDays: rule.expiryDays,
    startsAt: rule.startsAt ? rule.startsAt.toISOString() : null,
    endsAt: rule.endsAt ? rule.endsAt.toISOString() : null,
    status: rule.status,
  };
}

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
  /** このルール経由で付与されたOVEが何日で失効するか。未指定なら失効しない (docs/credit-expiry.md参照)。 */
  expiryDays?: number;
  /** 参加方法の案内先URL (docs/reward-landing-url.md参照)。 */
  landingUrl?: string;
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
  expiryDays?: number | null;
  /** 参加方法の案内先URL。空文字・nullで未設定に戻す。 */
  landingUrl?: string | null;
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
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly rewardRules: RewardRuleRepository,
  ) {}

  async list() {
    return this.rewardRules.listAll();
  }

  /**
   * ルールごとの累計発行額・件数 (docs/admin-operations.md「付与ルール別発行量集計」
   * 参照)。`RULE_CODE_BY_TRANSACTION_TYPE`に対応するtransaction_typeが登録されている
   * ルールのみ集計可能 (取引には`rule_code`への直接参照が無く、ルール↔取引種別の
   * 固定対応表でしか判定できないため)。対応の無いルールは`total_amount`/`count`が
   * `null`になる (0件ではなく「集計不能」を意味する)。
   */
  async getIssuanceSummary() {
    const rules = await this.rewardRules.listAll();
    const transactionTypeByRuleCode = new Map(
      Object.entries(RULE_CODE_BY_TRANSACTION_TYPE).map(([transactionType, ruleCode]) => [ruleCode, transactionType]),
    );

    return Promise.all(
      rules.map(async (rule) => {
        const transactionType = transactionTypeByRuleCode.get(rule.ruleCode);
        if (!transactionType) {
          return { ruleCode: rule.ruleCode, displayName: rule.displayName, totalAmount: null, count: null };
        }

        const aggregate = await this.db.oveTransaction.aggregate({
          where: { transactionType: transactionType as TransactionType, direction: "CREDIT", status: "COMPLETED" },
          _sum: { amount: true },
          _count: true,
        });

        return {
          ruleCode: rule.ruleCode,
          displayName: rule.displayName,
          totalAmount: (aggregate._sum.amount ?? 0n).toString(),
          count: aggregate._count,
        };
      }),
    );
  }

  async create(params: CreateRewardRuleParams) {
    const existing = await this.rewardRules.findByRuleCode(params.ruleCode);
    if (existing) throw new ConflictException(`reward rule ${params.ruleCode} already exists`);

    return this.rewardRules.create({
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
      expiryDays: params.expiryDays,
      landingUrl: toLandingUrl(params.landingUrl),
    });
  }

  /**
   * 付与ルールの変更。**誰がいつ何をいくらに変えたか**を監査ログに残す。
   *
   * 付与額や上限の変更は、以降のすべての付与額を左右する会計上の重要な操作
   * (高額な手動付与に二段階承認を課しているのと同じ理由)。変更前後の値を
   * 記録しておかないと、ポイント負債レポートの数字が動いた理由を後から追えない。
   */
  async update(ruleCode: string, params: UpdateRewardRuleParams, actorId: string) {
    const existing = await this.rewardRules.findByRuleCode(ruleCode);
    if (!existing) throw new NotFoundException(`reward rule ${ruleCode} not found`);

    const updated = await this.rewardRules.update(ruleCode, {
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
      expiryDays: params.expiryDays,
      // 未指定(undefined)は据え置き。空文字・nullは未設定に戻す。
      landingUrl: params.landingUrl === undefined ? undefined : toLandingUrl(params.landingUrl),
    });

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId,
        actionType: "REWARD_RULE_UPDATE",
        targetType: "reward_rule",
        targetId: existing.id,
        result: "SUCCESS",
        beforeData: auditSnapshot(existing),
        afterData: auditSnapshot(updated),
      },
    });

    return updated;
  }

  /**
   * 有効期限が到来した獲得ORIを失効させるバッチ。
   *
   * 通常は`SchedulerModule`が日次で自動実行する (`docs/runbooks/scheduled-jobs.md`)。
   * 管理画面からの臨時実行もこのメソッドを呼ぶ。自動・手動で挙動が分かれないよう
   * 処理を複製しない (docs/credit-expiry.md「運用」参照)。
   */
  async runExpiryBatch() {
    const result = await expireDueCreditLots(this.db);
    return {
      wallets_processed: result.walletsProcessed,
      total_expired_amount: result.totalExpiredAmount.toString(),
    };
  }

  /**
   * 失効バッチを実行した場合の影響範囲を、書き込みを行わずに事前確認する
   * (docs/credit-expiry.md「失効予告レポート」参照)。
   */
  async previewExpiryBatch() {
    const result = await previewExpiringCreditLots(this.db);
    return {
      wallets_affected: result.walletsProcessed,
      total_amount: result.totalExpiredAmount.toString(),
    };
  }
}
