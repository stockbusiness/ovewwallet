import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { Prisma, type OveTransaction, type PrismaClient, type ServiceIntegration, type TransactionType } from "@ove/database";
import { PRISMA } from "../common/prisma.module";
import { GrantRewardUseCase } from "./grant-reward.use-case";
import { ServiceIntegrationRepository } from "./service-integration.repository";

export interface GrantExternalServiceRewardParams {
  serviceIntegration: ServiceIntegration;
  oveAccountId: string;
  amount: bigint;
  transactionType: TransactionType;
  idempotencyKey: string;
  displayName: string;
  description?: string;
  sourceReferenceId?: string;
  metadata?: Prisma.InputJsonValue;
  ruleCode?: string;
}

export interface GrantExternalServiceRewardResult {
  transaction: OveTransaction;
}

/**
 * 追加整合性対策 P0-3: `ServiceIntegration.dailyAmountLimit`の並行突破を防ぐ。
 *
 * 従来の`RewardsService.grant`は「日次付与合計を集計→上限判定」と「CREDIT」が
 * 別々のトランザクションだった (`GrantRewardUseCase`はreward_rules行のみロックする)。
 * 同じServiceIntegrationから複数リクエストが同時に来ると、両方が同じ集計値を見て
 * 成功しうる (TOCTOU)。
 *
 * 本UseCaseは単一トランザクション内で以下を順に行う:
 * 1. idempotency再確認
 * 2. ServiceIntegration行ロック (`ServiceIntegrationRepository.lockById`)
 * 3. perRequestAmountLimit確認
 * 4. dailyAmountLimit集計・確認 (ロック後のため同一ServiceIntegrationへの並行付与は直列化済み)
 * 5-7. RewardRule行ロック・上限確認・CREDIT (`GrantRewardUseCase.executeInTransaction`を共有)
 *
 * ロック順序はデッドロック防止のため ServiceIntegration → RewardRule → Wallet で統一する
 * (`GrantRewardUseCase.executeInTransaction`内の順序と整合)。
 */
@Injectable()
export class GrantExternalServiceRewardUseCase {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly serviceIntegrations: ServiceIntegrationRepository,
    private readonly grantReward: GrantRewardUseCase,
  ) {}

  async execute(params: GrantExternalServiceRewardParams): Promise<GrantExternalServiceRewardResult> {
    // 冪等キーが既に処理済みなら、上限チェックより前に既存取引をそのまま返す
    // (再送/リトライは「新規リクエスト」ではないため、上限判定・日次上限消費の対象にしない)。
    const existing = await this.db.oveTransaction.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) return { transaction: existing };

    if (params.amount > params.serviceIntegration.perRequestAmountLimit) {
      throw new BadRequestException(
        `amount exceeds per_request_amount_limit (${params.serviceIntegration.perRequestAmountLimit.toString()})`,
      );
    }

    try {
      const transaction = await this.db.$transaction(async (tx) => {
        await this.serviceIntegrations.lockById(params.serviceIntegration.id, tx);

        const existingInTx = await tx.oveTransaction.findUnique({
          where: { idempotencyKey: params.idempotencyKey },
        });
        if (existingInTx) return existingInTx;

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayGranted = await tx.oveTransaction.aggregate({
          where: {
            sourceService: params.serviceIntegration.serviceCode,
            status: "COMPLETED",
            direction: "CREDIT",
            occurredAt: { gte: todayStart },
          },
          _sum: { amount: true },
        });
        const grantedToday = todayGranted._sum.amount ?? 0n;
        if (grantedToday + params.amount > params.serviceIntegration.dailyAmountLimit) {
          throw new BadRequestException("daily_amount_limit for this service has been exceeded");
        }

        return this.grantReward.executeInTransaction(tx, {
          oveAccountId: params.oveAccountId,
          amount: params.amount,
          transactionType: params.transactionType,
          idempotencyKey: params.idempotencyKey,
          displayName: params.displayName,
          description: params.description,
          sourceService: params.serviceIntegration.serviceCode,
          sourceReferenceId: params.sourceReferenceId,
          createdByType: "EXTERNAL_SERVICE",
          createdById: params.serviceIntegration.id,
          metadata: params.metadata,
          ruleCode: params.ruleCode,
        });
      });

      return { transaction };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const race = await this.db.oveTransaction.findUnique({
          where: { idempotencyKey: params.idempotencyKey },
        });
        if (race) return { transaction: race };
      }
      throw error;
    }
  }
}
