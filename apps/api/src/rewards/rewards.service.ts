import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient, ServiceIntegration, TransactionType } from "@ove/database";
import type { RewardGrantRequest } from "@ove/shared-types";
import { PRISMA } from "../common/prisma.module";
import { AccountsService } from "../accounts/accounts.service";
import { AccountRepository } from "../accounts/account.repository";
import { serializeTransaction } from "../wallets/wallets.service";
import { GrantRewardUseCase } from "./grant-reward.use-case";
import { RewardRuleRepository } from "./reward-rule.repository";

/**
 * transaction_type -> reward_rules.rule_code の対応 (指示書9章の初期2ルール分)。
 * `AdminRewardRulesService.getIssuanceSummary()` (docs/admin-operations.md
 * 「付与ルール別発行量集計」参照) からも、どのtransaction_typeがどのルール経由の
 * 付与かを判定するために参照する。
 */
export const RULE_CODE_BY_TRANSACTION_TYPE: Record<string, string> = {
  REGISTRATION_BONUS: "SENGOKU_REGISTRATION_BONUS",
  AIART_ATTENDANCE: "AIART_ATTENDANCE_REWARD",
  SENGOKU_EC_PURCHASE: "SENGOKU_EC_PURCHASE_REWARD",
};

@Injectable()
export class RewardsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly accounts: AccountsService,
    private readonly accountRepository: AccountRepository,
    private readonly grantReward: GrantRewardUseCase,
    private readonly rewardRules: RewardRuleRepository,
  ) {}

  /**
   * ウォレット画面の「OVEを貯める」向け。稼働中の付与ルールを、公開して問題ない
   * フィールドのみで返す (上限値・内部管理用コードなどは含めない)。
   */
  async listPublicRules() {
    const rules = await this.rewardRules.listActive(new Date());
    return rules.map((r) => ({
      rule_code: r.ruleCode,
      display_name: r.displayName,
      description: r.description,
      reward_amount: r.rewardAmount.toString(),
      source_service: r.sourceService,
      expiry_days: r.expiryDays,
    }));
  }

  async grant(request: RewardGrantRequest, serviceIntegration: ServiceIntegration) {
    // 冪等キーが既に処理済みなら、上限チェックより前に既存取引をそのまま返す。
    // (再送/リトライは "新規リクエスト" ではないため、上限判定の対象にしない)
    const existing = await this.db.oveTransaction.findUnique({
      where: { idempotencyKey: request.idempotency_key },
    });
    if (existing) {
      const account = await this.accountRepository.findFirstByWalletIdOrThrow(existing.walletId);
      return { ove_account_id: account.id, ...serializeTransaction(existing) };
    }

    if (serviceIntegration.serviceCode !== request.service_code) {
      throw new BadRequestException("service_code does not match the authenticated API key");
    }

    const amount = BigInt(request.amount);
    if (amount > serviceIntegration.perRequestAmountLimit) {
      throw new BadRequestException(
        `amount exceeds per_request_amount_limit (${serviceIntegration.perRequestAmountLimit.toString()})`,
      );
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayGranted = await this.db.oveTransaction.aggregate({
      where: {
        sourceService: request.service_code,
        status: "COMPLETED",
        direction: "CREDIT",
        occurredAt: { gte: todayStart },
      },
      _sum: { amount: true },
    });
    const grantedToday = todayGranted._sum.amount ?? 0n;
    if (grantedToday + amount > serviceIntegration.dailyAmountLimit) {
      throw new BadRequestException("daily_amount_limit for this service has been exceeded");
    }

    const account = await this.accounts.findOrCreateByServiceLink({
      serviceIntegrationId: serviceIntegration.id,
      externalUserId: request.external_user_id,
    });
    const transactionType = request.transaction_type as TransactionType;
    const ruleCode = RULE_CODE_BY_TRANSACTION_TYPE[request.transaction_type];

    const { transaction } = await this.grantReward.execute({
      oveAccountId: account.id,
      amount,
      transactionType,
      idempotencyKey: request.idempotency_key,
      displayName: request.display_name,
      description: request.description,
      sourceService: request.service_code,
      sourceReferenceId: request.event_id,
      createdByType: "EXTERNAL_SERVICE",
      createdById: serviceIntegration.id,
      metadata: { eventType: request.event_type, eventId: request.event_id },
      ruleCode,
    });

    return { ove_account_id: account.id, ...serializeTransaction(transaction) };
  }
}
