import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  generateId,
  nextDisplayCode,
  Prisma,
  ACCOUNT_CODE_COUNTER,
  WALLET_CODE_COUNTER,
  type OveAccount,
  type OveTransaction,
  type PrismaClient,
  type ServiceIntegration,
  type TransactionType,
} from "@ove/database";
import { AccountRepository } from "../accounts/account.repository";
import { PRISMA } from "../common/prisma.module";
import { GrantRewardUseCase } from "./grant-reward.use-case";
import { ServiceIntegrationRepository } from "./service-integration.repository";

export interface GrantExternalServiceRewardParams {
  serviceIntegration: ServiceIntegration;
  externalUserId: string;
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
  oveAccountId: string;
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
 * 5. AccountLink検索、未連携ならAccount・Wallet・AccountLinkを作成
 * 6-8. RewardRule行ロック・上限確認・CREDIT (`GrantRewardUseCase.executeInTransaction`を共有)
 *
 * ロック順序はデッドロック防止のため ServiceIntegration → RewardRule → Wallet で統一する
 * (`GrantRewardUseCase.executeInTransaction`内の順序と整合)。
 *
 * PR #1最終修正 (1/2): `lockById`はロックを取得するだけで行の内容を返さないため、以前は
 * ロック後も呼び出し元 (`ExternalApiAuthGuard`が認証時に読んだスナップショット) の
 * `params.serviceIntegration`をそのまま使っていた。ロック待ち中に管理者が
 * status/serviceCode/perRequestAmountLimit/dailyAmountLimitを変更した場合、古い設定で
 * CREDITされてしまう不整合があった。ロック後は`findById`で必ず再取得し、`params.serviceIntegration`
 * は対象行を特定するための`.id`以外に使わない。
 *
 * PR #1最終修正 (2/2): 以前は`RewardsService.grant`が上限判定より前に
 * `ExternalAccountProvisioningService.findOrCreateByServiceLink`でOveAccount/Wallet/
 * AccountLinkを作成していたため、上限超過で拒否されても残高0の外部ユーザーレコードが
 * 残ってしまっていた。アカウント解決自体もServiceIntegration行ロック配下・上限確認より
 * 後ろへ移し、拒否時は何も作らないようにした (このロックは同一ServiceIntegrationへの
 * 全リクエストを直列化するため、`findOrCreateByServiceLink`が担っていたAccountLinkの
 * 一意制約競合リトライは不要になった)。
 */
@Injectable()
export class GrantExternalServiceRewardUseCase {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly accountRepository: AccountRepository,
    private readonly serviceIntegrations: ServiceIntegrationRepository,
    private readonly grantReward: GrantRewardUseCase,
  ) {}

  async execute(params: GrantExternalServiceRewardParams): Promise<GrantExternalServiceRewardResult> {
    // 冪等キーが既に処理済みなら、上限チェックより前に既存取引をそのまま返す
    // (再送/リトライは「新規リクエスト」ではないため、上限判定・日次上限消費の対象にしない)。
    const existing = await this.db.oveTransaction.findUnique({
      where: { idempotencyKey: params.idempotencyKey },
    });
    if (existing) {
      const account = await this.accountRepository.findFirstByWalletIdOrThrow(existing.walletId);
      return { oveAccountId: account.id, transaction: existing };
    }

    try {
      const result = await this.db.$transaction(async (tx) => {
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
        if (existingInTx) {
          const account = await this.accountRepository.findFirstByWalletIdOrThrow(existingInTx.walletId, tx);
          return { oveAccountId: account.id, transaction: existingInTx };
        }

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

        // 上限確認をすべて通過した後にのみアカウントを解決する (拒否時に不要な
        // OveAccount/Wallet/AccountLinkを残さないため)。
        const account = await this.findOrCreateAccount(tx, current.id, params.externalUserId);

        const transaction = await this.grantReward.executeInTransaction(tx, {
          oveAccountId: account.id,
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

        return { oveAccountId: account.id, transaction };
      });

      return result;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const race = await this.db.oveTransaction.findUnique({
          where: { idempotencyKey: params.idempotencyKey },
        });
        if (race) {
          const account = await this.accountRepository.findFirstByWalletIdOrThrow(race.walletId);
          return { oveAccountId: account.id, transaction: race };
        }
      }
      throw error;
    }
  }

  /**
   * サービス連携 (account_links) からOVEアカウントを解決する。未連携なら
   * アカウント・ウォレット・連携をまとめて作成する。呼び出し元がServiceIntegration行の
   * ロックを既に保持しているため、同一ServiceIntegrationへの並行呼び出しはここに来る前に
   * 直列化されている (同一(serviceIntegrationId, externalUserId)へのaccount_links一意制約
   * 違反は起こり得ない)。
   */
  private async findOrCreateAccount(
    tx: Prisma.TransactionClient,
    serviceIntegrationId: string,
    externalUserId: string,
  ): Promise<OveAccount> {
    const existingLink = await tx.accountLink.findUnique({
      where: { serviceIntegrationId_externalUserId: { serviceIntegrationId, externalUserId } },
      include: { account: true },
    });
    if (existingLink?.account) return existingLink.account;

    const accountCode = await nextDisplayCode(tx, ACCOUNT_CODE_COUNTER, "OVE-ACC");
    const account = await this.accountRepository.create(tx, { id: generateId(), accountCode, status: "ACTIVE" });

    const walletCode = await nextDisplayCode(tx, WALLET_CODE_COUNTER, "OVE-WLT");
    await tx.wallet.create({
      data: { id: generateId(), oveAccountId: account.id, walletCode, status: "ACTIVE" },
    });

    if (existingLink) {
      // PENDING (代理店同期等で受信済みだがOVEアカウント未作成) の連携が既にある場合は、
      // 新規作成したアカウントへ昇格させる (重複するaccount_links行を作らない)。
      await tx.accountLink.update({
        where: { id: existingLink.id },
        data: { oveAccountId: account.id, status: "ACTIVE", verifiedAt: new Date() },
      });
    } else {
      await tx.accountLink.create({
        data: {
          id: generateId(),
          oveAccountId: account.id,
          serviceIntegrationId,
          externalUserId,
          status: "ACTIVE",
          linkMethod: "API_AUTO_PROVISION",
          verifiedAt: new Date(),
        },
      });
    }

    await tx.auditLog.create({
      data: {
        id: generateId(),
        actorType: "EXTERNAL_SERVICE",
        actionType: "ACCOUNT_CREATED",
        targetType: "ove_account",
        targetId: account.id,
        result: "SUCCESS",
        afterData: { accountCode, serviceIntegrationId } as unknown as Prisma.InputJsonValue,
      },
    });

    return account;
  }
}
