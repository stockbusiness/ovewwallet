import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient, ServiceIntegration, TransactionType } from "@ove/database";
import type { RewardGrantRequest } from "@ove/shared-types";
import { serializeTransaction } from "../wallets/wallets.service";
import { GrantExternalServiceRewardUseCase } from "./grant-external-service-reward.use-case";
import { RewardRuleRepository } from "./reward-rule.repository";
import { RULE_CODE_BY_TRANSACTION_TYPE, transactionTypesForRuleCode } from "./rule-code-mapping";
import { PRISMA } from "../common/prisma.module";

export { RULE_CODE_BY_TRANSACTION_TYPE } from "./rule-code-mapping";

@Injectable()
export class RewardsService {
  constructor(
    private readonly grantExternalServiceReward: GrantExternalServiceRewardUseCase,
    private readonly rewardRules: RewardRuleRepository,
    @Inject(PRISMA) private readonly db: PrismaClient,
  ) {}

  /**
   * ウォレット画面の「ORIを貯める」向け。稼働中の付与ルールを、公開して問題ない
   * フィールドのみで返す (上限値・内部管理用コードなどは含めない)。
   *
   * `landing_url` は参加方法の案内先 (LINE友だち追加など)。未設定なら null で、
   * 画面側は導線を出さない (`docs/reward-landing-url.md`)。
   *
   * `already_earned` は、この利用者が既にその特典を受け取っているか。参加特典は
   * `perEventLimit: 1` のように1回限りのものがあり、受け取り済みの人に「もらえます」と
   * 出し続けると事実に反するため、画面側で出し分けられるようにする。
   */
  async listPublicRules(oveAccountId: string) {
    const rules = await this.rewardRules.listActive(new Date());
    const earnedTypes = await this.earnedTransactionTypes(oveAccountId);

    return rules.map((r) => ({
      rule_code: r.ruleCode,
      display_name: r.displayName,
      description: r.description,
      reward_amount: r.rewardAmount.toString(),
      source_service: r.sourceService,
      expiry_days: r.expiryDays,
      landing_url: r.landingUrl,
      already_earned: transactionTypesForRuleCode(r.ruleCode).some((t) => earnedTypes.has(t)),
    }));
  }

  /**
   * この利用者が受け取ったことのある特典の取引種別。
   *
   * 取消済み (`REVERSED`) は含めない。取り消された付与は受け取っていないのと同じで、
   * 上限判定でも消費扱いにならないため、案内は再び出すのが正しい。
   */
  private async earnedTransactionTypes(oveAccountId: string): Promise<Set<string>> {
    const wallet = await this.db.wallet.findUnique({ where: { oveAccountId }, select: { id: true } });
    if (!wallet) return new Set();

    const rows = await this.db.oveTransaction.groupBy({
      by: ["transactionType"],
      where: { walletId: wallet.id, status: "COMPLETED", direction: "CREDIT" },
    });
    return new Set(rows.map((row) => row.transactionType));
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
