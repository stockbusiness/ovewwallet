/**
 * transaction_type -> reward_rules.rule_code の対応 (指示書9章の初期2ルール分)。
 * `AdminRewardRulesService.getIssuanceSummary()` (docs/admin-operations.md
 * 「付与ルール別発行量集計」参照) からも、どのtransaction_typeがどのルール経由の
 * 付与かを判定するために参照する。
 *
 * `rewards.service.ts`から分離しているのは、`wallets`側 (外部サービス向け取引照会API、
 * `service-transactions.service.ts`) からも参照する必要があり、`rewards.service.ts`自体は
 * `wallets/wallets.service.ts`に依存しているため、直接importすると循環依存になるため
 * (依存の向き: rewards -> wallets は既存、wallets -> rewards/rule-code-mapping のみ許容し、
 * wallets -> rewards/rewards.service は作らない)。
 */
export const RULE_CODE_BY_TRANSACTION_TYPE: Record<string, string> = {
  REGISTRATION_BONUS: "SENGOKU_REGISTRATION_BONUS",
  WALLET_SIGNUP_BONUS: "WALLET_SIGNUP_BONUS",
  PROFILE_COMPLETION_BONUS: "PROFILE_COMPLETION_BONUS",
  AIART_ATTENDANCE: "AIART_ATTENDANCE_REWARD",
  SENGOKU_EC_PURCHASE: "SENGOKU_EC_PURCHASE_REWARD",
  LEARNING_JOURNEY_REWARD: "SENGOKU_LEARNING_JOURNEY_REWARD",
};

/** rule_code から対応する transaction_type の一覧を逆引きする (現状は常に高々1件)。 */
export function transactionTypesForRuleCode(ruleCode: string): string[] {
  return Object.entries(RULE_CODE_BY_TRANSACTION_TYPE)
    .filter(([, code]) => code === ruleCode)
    .map(([transactionType]) => transactionType);
}
