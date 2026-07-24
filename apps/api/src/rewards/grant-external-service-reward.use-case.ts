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
 * 3. 最新ServiceIntegrationの再取得・status/serviceCode/perRequestAmountLimit確認
 * 4. dailyAmountLimit集計・確認 (ロック後のため同一ServiceIntegrationへの並行付与は直列化済み)
 * 5-7. RewardRule行ロック・上限確認・CREDIT (`GrantRewardUseCase.executeInTransaction`を共有)
 *
 * ロック順序はデッドロック防止のため ServiceIntegration → RewardRule → Wallet で統一する
 * (`GrantRewardUseCase.executeInTransaction`内の順序と整合)。
 *
 * PR #1最終修正: `lockById`はロックを取得するだけで行の内容を返さないため、以前は
 * ロック後も呼び出し元 (`ExternalApiAuthGuard`が認証時に読んだスナップショット) の
 * `params.serviceIntegration`をそのまま使っていた。ロック待ち中に管理者が
 * status/serviceCode/perRequestAmountLimit/dailyAmountLimitを変更した場合、古い設定で
 * CREDITされてしまう不整合があった。ロック後は`findById`で必ず再取得し、`params.serviceIntegration`
 * は対象行を特定するための`.id`以外に使わない。
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

    try {
      const transaction = await this.db.$transaction(async (tx) => {
        await this.serviceIntegrations.lockById(params.serviceIntegration.id, tx);

        const current = await this.serviceIntegrations.findById(params.serviceIntegration.id, tx);
        if (!current) {
          throw new BadRequestException("service integration not found");
        }
        if (current.status !== "ACTIVE") {
          throw new BadRequestException(`service integration is ${current.status.toLowerCase()}`);
        }
        if (current.serviceCode !== params.serviceIntegration.serviceCode) {
          throw new BadRequestException("service_code does not match the authenticated service integration");
        }

        const existingInTx = await tx.oveTransaction.findUnique({
          where: { idempotencyKey: params.idempotencyKey },
        });
        if (existingInTx) return existingInTx;

        if (params.amount > current.perRequestAmountLimit) {
          throw new BadRequestException(`amount exceeds per_request_amount_limit (${current.perRequestAmountLimit.toString()})`);
        }

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayGranted = await tx.oveTransaction.aggregate({
          where: {
            sourceService: current.serviceCode,
            status: "COMPLETED",
            direction: "CREDIT",
            occurredAt: { gte: todayStart },
          },
          _sum: { amount: true },
        });
        const grantedToday = todayGranted._sum.amount ?? 0n;
        if (grantedToday + params.amount > current.dailyAmountLimit) {
          throw new BadRequestException("daily_amount_limit for this service has been exceeded");
        }

        return this.grantReward.executeInTransaction(tx, {
          oveAccountId: params.oveAccountId,
          amount: params.amount,
          transactionType: params.transactionType,
          idempotencyKey: params.idempotencyKey,
          displayName: params.displayName,
          description: params.description,
          sourceService: current.serviceCode,
          sourceReferenceId: params.sourceReferenceId,
          createdByType: "EXTERNAL_SERVICE",
          createdById: current.id,
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
