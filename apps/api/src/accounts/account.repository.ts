import { Inject, Injectable } from "@nestjs/common";
import type { AccountStatus, OveAccount, Prisma, PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

type Db = PrismaClient | Prisma.TransactionClient;

export interface ListAccountsParams {
  status?: string;
  take: number;
}

/**
 * リファクタリング指示書 Phase 8「DBアクセス境界」。`accounts/*`・`admin/*`・
 * `common-events/*`・`referrals/*`・`rewards/*`・`SessionAuthGuard`が個別に
 * 行っていた`OveAccount`へのPrismaアクセスを集約する。`wallet`/`accountIdentity`/
 * `accountLink`/`auditLog`等の関連モデルは対象外 (指示書のRepository化対象6つに
 * `OveAccount`以外は含まれないため、各呼び出し元が引き続き直接扱う)。
 *
 * `AccountsModule`が所有するが、`CommonEventsModule`/`ReferralsModule`/
 * `RewardsModule`や、どのモジュールにも登録されていない`SessionAuthGuard`からも
 * 参照されるため、`RepositoriesModule` (`@Global()`) 経由で提供する。
 */
@Injectable()
export class AccountRepository {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  async findById(id: string, client: Db = this.db): Promise<OveAccount | null> {
    return client.oveAccount.findUnique({ where: { id } });
  }

  async findByIdWithWallet(id: string, client: Db = this.db) {
    return client.oveAccount.findUnique({ where: { id }, include: { wallet: true } });
  }

  /** アカウント詳細画面 (指示書13章) 向けの連携情報込み1件取得。 */
  async findAccountDetail(id: string, client: Db = this.db) {
    return client.oveAccount.findUnique({
      where: { id },
      include: {
        wallet: true,
        identities: { orderBy: { createdAt: "desc" } },
        links: { include: { serviceIntegration: { select: { serviceCode: true, serviceName: true } } } },
        mergedIntoAccount: { select: { id: true, accountCode: true } },
        mergedAccounts: { select: { id: true, accountCode: true } },
      },
    });
  }

  async findByAccountCode(accountCode: string, client: Db = this.db): Promise<OveAccount | null> {
    return client.oveAccount.findUnique({ where: { accountCode } });
  }

  async findByAccountCodeOrThrow(accountCode: string, client: Db = this.db): Promise<OveAccount> {
    return client.oveAccount.findUniqueOrThrow({ where: { accountCode } });
  }

  async countAll(client: Db = this.db): Promise<number> {
    return client.oveAccount.count();
  }

  /** 管理画面のアカウント一覧・CSVエクスポートで共用 (`take`の上限のみ呼び出し元で変える)。 */
  async list(params: ListAccountsParams, client: Db = this.db) {
    return client.oveAccount.findMany({
      where: params.status ? { status: params.status as never } : undefined,
      orderBy: { createdAt: "desc" },
      take: params.take,
      include: { wallet: true },
    });
  }

  async findManyByCommonUserId(commonUserId: string, client: Db = this.db): Promise<OveAccount[]> {
    return client.oveAccount.findMany({ where: { commonUserId } });
  }

  async findManyByCommonUserIds(commonUserIds: string[], client: Db = this.db): Promise<OveAccount[]> {
    return client.oveAccount.findMany({ where: { commonUserId: { in: commonUserIds } } });
  }

  /**
   * モジュール化後レビュー対応 P1-2: `common_user_id`はUNIQUE制約が無いため、
   * 自アカウント以外に同じ値が既に設定されていないか、保存前に必ず確認する
   * (`common_user.resolved`受信時・`CommonUserHubClient.resolve`後の両経路で使用)。
   */
  async findConflictingCommonUserLinks(
    commonUserId: string,
    excludeAccountId: string,
    client: Db = this.db,
  ): Promise<OveAccount[]> {
    return client.oveAccount.findMany({ where: { commonUserId, id: { not: excludeAccountId } } });
  }

  async findFirstByWalletIdOrThrow(walletId: string, client: Db = this.db): Promise<OveAccount> {
    return client.oveAccount.findFirstOrThrow({ where: { wallet: { id: walletId } } });
  }

  /** 新規アカウント作成 (`AccountRegistrationService`/`ExternalAccountProvisioningService`)。
   * 常に呼び出し元が開いた`$transaction`内から呼ぶため`tx`を必須にする。 */
  async create(tx: Prisma.TransactionClient, data: Prisma.OveAccountUncheckedCreateInput): Promise<OveAccount> {
    return tx.oveAccount.create({ data });
  }

  async linkCommonUser(id: string, commonUserId: string, client: Db = this.db): Promise<OveAccount> {
    return client.oveAccount.update({ where: { id }, data: { commonUserId, commonUserLinkedAt: new Date() } });
  }

  /** ユーザー本人による退会。残高確認・セッション失効と同一トランザクションで呼ぶため`tx`を必須にする。 */
  async closeAccount(tx: Prisma.TransactionClient, id: string): Promise<OveAccount> {
    return tx.oveAccount.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date() } });
  }

  async updateStatus(id: string, status: AccountStatus, client: Db = this.db): Promise<OveAccount> {
    return client.oveAccount.update({ where: { id }, data: { status } });
  }
}
