import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient, ServiceIntegration, TransactionType } from "@ove/database";
import { creditWallet } from "@ove/ledger";
import type { RewardGrantRequest } from "@ove/shared-types";
import { PRISMA } from "../common/prisma.module";
import { AccountsService } from "../accounts/accounts.service";
import { serializeTransaction } from "../wallets/wallets.service";
import { enforceRewardRuleLimits } from "./reward-rule-limits";

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
  ) {}

  /**
   * ウォレット画面の「OVEを貯める」向け。稼働中の付与ルールを、公開して問題ない
   * フィールドのみで返す (上限値・内部管理用コードなどは含めない)。
   */
  async listPublicRules() {
    const now = new Date();
    const rules = await this.db.rewardRule.findMany({
      where: {
        status: "ACTIVE",
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      orderBy: { createdAt: "asc" },
    });
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
      const account = await this.db.oveAccount.findFirstOrThrow({
        where: { wallet: { id: existing.walletId } },
      });
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
    const wallet = await this.db.wallet.findUniqueOrThrow({ where: { oveAccountId: account.id } });
    const transactionType = request.transaction_type as TransactionType;

    const ruleCode = RULE_CODE_BY_TRANSACTION_TYPE[request.transaction_type];
    let expiryDays: number | null = null;
    if (ruleCode) {
      const rule = await enforceRewardRuleLimits(this.db, {
        ruleCode,
        walletId: wallet.id,
        transactionType,
        eventId: request.event_id,
        amount,
      });
      expiryDays = rule?.expiryDays ?? null;
    }

    const transaction = await creditWallet(
      {
        walletId: wallet.id,
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
        expiresAt: expiryDays ? new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000) : undefined,
      },
      this.db,
    );

    return { ove_account_id: account.id, ...serializeTransaction(transaction) };
  }
}
