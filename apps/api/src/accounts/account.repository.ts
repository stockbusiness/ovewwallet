import { Inject, Injectable } from "@nestjs/common";
import type { AccountStatus, OveAccount, Prisma, PrismaClient } from "@ove/database";
import { PRISMA } from "../common/prisma.module";

type Db = PrismaClient | Prisma.TransactionClient;

export interface ListAccountsParams {
  status?: string;
  /**
   * アカウントコード・メールアドレス・電話番号・表示名・common_user_id を
   * 横断して部分一致で探す。問い合わせ対応では利用者から提示される情報が
   * まちまち (メールアドレスのことも表示名のことも代理店側のIDのこともある) なため、
   * 項目を指定させず1つの入力欄でまとめて引けるようにする。
   */
  search?: string;
  take: number;
}

/**
 * 検索文字列から where 条件を組み立てる。空文字・空白のみは「絞り込みなし」として
 * 扱う (検索欄を空にしたときに0件にならないようにする)。
 *
 * 大文字小文字は区別しない。アカウントコード (`OVE-ACC-00001234`) は英大文字のみだが、
 * 利用者が小文字で伝えてくることがあるため同様に扱う。
 *
 * 部分一致のため索引は効かず、件数が増えると全表スキャンになる。現在の規模では
 * `take` の上限 (画面200件・CSV10,000件) と併せて問題にならないが、アカウント数が
 * 大きく増えた場合は pg_trgm の GIN 索引の追加を検討すること。
 */
function buildSearchFilter(search: string | undefined): Prisma.OveAccountWhereInput | undefined {
  const q = search?.trim();
  if (!q) return undefined;

  const contains = { contains: q, mode: "insensitive" } as const;
  return {
    OR: [
      { accountCode: contains },
      { primaryEmail: contains },
      { primaryPhone: contains },
      { displayName: contains },
      { commonUserId: contains },
    ],
  };
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
    const searchFilter = buildSearchFilter(params.search);
    const statusFilter: Prisma.OveAccountWhereInput | undefined = params.status
      ? { status: params.status as AccountStatus }
      : undefined;
    // 状態と検索語の両方が指定された場合は AND (絞り込みを重ねる) にする。
    const conditions = [statusFilter, searchFilter].filter(
      (c): c is Prisma.OveAccountWhereInput => c !== undefined,
    );

    return client.oveAccount.findMany({
      where: conditions.length > 0 ? { AND: conditions } : undefined,
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
   * 他アカウントに同じ`common_user_id`が既に設定されていないか確認する
   * (`common_user.resolved`受信時・`CommonUserHubClient.resolve`後の両経路で使用)。
   * 追加整合性対策P0-1: `CommonUserLinkingUseCase.link`が`lockByCommonUserId`
   * (advisory lock) 取得後のトランザクション内でこれを呼ぶことで、事前確認
   * (TOCTOU) ではなく権威ある競合判定として機能する。
   */
  async findConflictingCommonUserLinks(
    commonUserId: string,
    excludeAccountId: string,
    client: Db = this.db,
  ): Promise<OveAccount[]> {
    return client.oveAccount.findMany({ where: { commonUserId, id: { not: excludeAccountId } } });
  }

  /**
   * 追加整合性対策P0-1: `common_user_id`単位のPostgreSQL advisory lock
   * (`pg_advisory_xact_lock`、トランザクション終了時に自動解放) を取得する。
   * 同じcommon_user_idへの並行`link()`呼び出しを直列化し、異なるcommon_user_id
   * 同士は互いにブロックしない (`reward_rules`行ロックと異なり専用テーブルの
   * 行が無いため、値そのものをロックキーにする)。呼び出し元の`$transaction`内で、
   * 競合再確認より前に呼ぶこと。
   */
  async lockByCommonUserId(commonUserId: string, tx: Prisma.TransactionClient): Promise<void> {
    // pg_advisory_xact_lockはvoidを返すため、行の列型を解釈しようとする$queryRawでは
    // "Failed to deserialize column of type 'void'"になる。副作用 (ロック取得) だけが
    // 目的なので$executeRawを使う。
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${commonUserId})::bigint)`;
  }

  /**
   * 追加整合性対策P0-2: `ove_accounts`行を`SELECT...FOR UPDATE`でロックする
   * (`packages/ledger`の`lockWallet`と同じ設計)。呼び出し元の`$transaction`内で、
   * `registrationReferrerAgencyId`等の「現在値に基づく判定」より前に呼ぶこと
   * (ロック後に`findById(id, tx)`で再取得した値が権威ある最新状態になる)。
   */
  async lockById(id: string, tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT id FROM ove_accounts WHERE id = ${id} FOR UPDATE`;
  }

  async findFirstByWalletIdOrThrow(walletId: string, client: Db = this.db): Promise<OveAccount> {
    return client.oveAccount.findFirstOrThrow({ where: { wallet: { id: walletId } } });
  }

  /** 新規アカウント作成 (`AccountRegistrationService`/`GrantExternalServiceRewardUseCase`)。
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
