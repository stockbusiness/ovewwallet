import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { PrismaClient, ServiceIntegration, TransactionType } from "@ove/database";
import { creditWallet } from "@ove/ledger";
import type { RewardGrantRequest } from "@ove/shared-types";
import { PRISMA } from "../common/prisma.module";
import { AccountsService } from "../accounts/accounts.service";
import { serializeTransaction } from "../wallets/wallets.service";

/** transaction_type -> reward_rules.rule_code の対応 (指示書9章の初期2ルール分)。 */
const RULE_CODE_BY_TRANSACTION_TYPE: Record<string, string> = {
  REGISTRATION_BONUS: "SENGOKU_REGISTRATION_BONUS",
  AIART_ATTENDANCE: "AIART_ATTENDANCE_REWARD",
};

@Injectable()
export class RewardsService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly accounts: AccountsService,
  ) {}

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
    if (ruleCode) {
      await this.enforceRuleLimits(ruleCode, wallet.id, transactionType, request.event_id);
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
      },
      this.db,
    );

    return { ove_account_id: account.id, ...serializeTransaction(transaction) };
  }

  private async enforceRuleLimits(
    ruleCode: string,
    walletId: string,
    transactionType: TransactionType,
    eventId: string,
  ): Promise<void> {
    const rule = await this.db.rewardRule.findUnique({ where: { ruleCode } });
    if (!rule || rule.status !== "ACTIVE") return;

    if (rule.perUserLimit) {
      const count = await this.db.oveTransaction.count({
        where: { walletId, transactionType, status: "COMPLETED" },
      });
      if (count >= rule.perUserLimit) {
        throw new BadRequestException(`per_user_limit (${rule.perUserLimit}) already reached for ${ruleCode}`);
      }
    }

    if (rule.perEventLimit) {
      const count = await this.db.oveTransaction.count({
        where: {
          walletId,
          transactionType,
          sourceReferenceId: eventId,
          status: "COMPLETED",
        },
      });
      if (count >= rule.perEventLimit) {
        throw new BadRequestException(`per_event_limit (${rule.perEventLimit}) already reached for ${ruleCode}`);
      }
    }
  }
}
