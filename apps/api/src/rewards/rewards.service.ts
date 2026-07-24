import { BadRequestException, Injectable } from "@nestjs/common";
import type { ServiceIntegration, TransactionType } from "@ove/database";
import type { RewardGrantRequest } from "@ove/shared-types";
import { serializeTransaction } from "../wallets/wallets.service";
import { GrantExternalServiceRewardUseCase } from "./grant-external-service-reward.use-case";
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
    private readonly grantExternalServiceReward: GrantExternalServiceRewardUseCase,
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
    if (serviceIntegration.serviceCode !== request.service_code) {
      throw new BadRequestException("service_code does not match the authenticated API key");
    }

    const amount = BigInt(request.amount);
    const transactionType = request.transaction_type as TransactionType;
    const ruleCode = RULE_CODE_BY_TRANSACTION_TYPE[request.transaction_type];

    // 追加整合性対策P0-3・PR#1最終修正: idempotency確認・perRequestAmountLimit/
    // dailyAmountLimitの判定・アカウント解決 (未連携なら作成)・CREDITを、すべて
    // ServiceIntegration行ロック配下の単一トランザクションで行う
    // (`GrantExternalServiceRewardUseCase`参照)。上限超過等で拒否された場合は
    // OveAccount/Wallet/AccountLinkを一切作らない。
    const { oveAccountId, transaction } = await this.grantExternalServiceReward.execute({
      serviceIntegration,
      externalUserId: request.external_user_id,
      amount,
      transactionType,
      idempotencyKey: request.idempotency_key,
      displayName: request.display_name,
      description: request.description,
      sourceReferenceId: request.event_id,
      metadata: { eventType: request.event_type, eventId: request.event_id },
      ruleCode,
    });

    return { ove_account_id: oveAccountId, ...serializeTransaction(transaction) };
  }
}
