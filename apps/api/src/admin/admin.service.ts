import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, type OveTransaction, type PrismaClient } from "@ove/database";
import {
  creditWallet,
  debitWallet,
  holdBalance,
  releaseHold,
  reconcileAllWallets,
  reverseTransaction,
} from "@ove/ledger";
import { PRISMA } from "../common/prisma.module";
import { toCsv } from "../common/csv";
import { serializeTransaction } from "../wallets/wallets.service";
import { AdminApprovalService, HIGH_VALUE_THRESHOLD } from "./admin-approval.service";

/**
 * `packages/shared-ui/src/rank.ts`のWALLET_RANKSと同じ定義 (docs/wallet-rank.md参照)。
 * バックエンドをUIパッケージ (Reactコンポーネント込み) に依存させたくないため、
 * しきい値のみ独立して保持する。階級を追加・変更する場合は両方を更新すること。
 */
const WALLET_RANK_THRESHOLDS = [
  { name: "足軽", min: 0 },
  { name: "侍", min: 5000 },
  { name: "武将", min: 20000 },
  { name: "大名", min: 50000 },
  { name: "天下人", min: 100000 },
];

@Injectable()
export class AdminService {
  constructor(
    @Inject(PRISMA) private readonly db: PrismaClient,
    private readonly approvals: AdminApprovalService,
  ) {}

  /** PC向け管理ダッシュボード (指示書13章) 用の集計値・過去30日推移。 */
  async getDashboardStats(): Promise<{
    totalAccounts: number;
    todayCredited: string;
    todayDebited: string;
    dailyTrend: Array<{ date: string; credited: string; debited: string }>;
  }> {
    const totalAccounts = await this.db.oveAccount.count();

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const since = new Date(todayStart);
    since.setDate(since.getDate() - 29);

    const rows = await this.db.oveTransaction.findMany({
      where: {
        occurredAt: { gte: since },
        status: "COMPLETED",
        transactionType: { notIn: ["HOLD", "RELEASE"] },
      },
      select: { occurredAt: true, direction: true, amount: true },
    });

    const trend = new Map<string, { credited: bigint; debited: bigint }>();
    for (let i = 0; i < 30; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      trend.set(d.toISOString().slice(0, 10), { credited: 0n, debited: 0n });
    }

    let todayCredited = 0n;
    let todayDebited = 0n;

    for (const row of rows) {
      const key = row.occurredAt.toISOString().slice(0, 10);
      const bucket = trend.get(key);
      if (bucket) {
        if (row.direction === "CREDIT") bucket.credited += row.amount;
        else bucket.debited += row.amount;
      }
      if (row.occurredAt >= todayStart) {
        if (row.direction === "CREDIT") todayCredited += row.amount;
        else todayDebited += row.amount;
      }
    }

    return {
      totalAccounts,
      todayCredited: todayCredited.toString(),
      todayDebited: todayDebited.toString(),
      dailyTrend: Array.from(trend.entries()).map(([date, v]) => ({
        date,
        credited: v.credited.toString(),
        debited: v.debited.toString(),
      })),
    };
  }

  /** ダッシュボード向け、会員ランク (docs/wallet-rank.md) の人数分布。 */
  async getRankDistribution(): Promise<Array<{ name: string; count: number }>> {
    const wallets = await this.db.wallet.findMany({ select: { lifetimeCredited: true } });
    const counts = WALLET_RANK_THRESHOLDS.map((r) => ({ name: r.name, count: 0 }));

    for (const wallet of wallets) {
      const credited = Number(wallet.lifetimeCredited);
      let rankIndex = 0;
      for (let i = 0; i < WALLET_RANK_THRESHOLDS.length; i++) {
        if (credited >= WALLET_RANK_THRESHOLDS[i]!.min) rankIndex = i;
      }
      counts[rankIndex]!.count += 1;
    }

    return counts;
  }

  async listAccounts(params: { status?: string; limit?: number }) {
    return this.db.oveAccount.findMany({
      where: params.status ? { status: params.status as never } : undefined,
      orderBy: { createdAt: "desc" },
      take: Math.min(params.limit ?? 50, 200),
      include: { wallet: true },
    });
  }

  /**
   * アカウント一覧CSVエクスポート (docs/admin-operations.md参照)。画面の一覧
   * (200件上限) とは別に、直近10,000件を上限として返す
   * (`docs/transaction-export.md`と同じ方針)。状態での絞り込みも一覧画面と同様に可能。
   */
  async exportAccountsCsv(params: { status?: string }): Promise<string> {
    const accounts = await this.db.oveAccount.findMany({
      where: params.status ? { status: params.status as never } : undefined,
      orderBy: { createdAt: "desc" },
      take: 10000,
      include: { wallet: true },
    });

    const header = ["アカウントコード", "状態", "表示名", "メールアドレス", "登録日時", "ウォレットコード", "利用可能残高"];
    const rows = accounts.map((a) => [
      a.accountCode,
      a.status,
      a.displayName ?? "",
      a.primaryEmail ?? "",
      a.createdAt.toISOString(),
      a.wallet?.walletCode ?? "",
      a.wallet ? a.wallet.availableBalance.toString() : "",
    ]);

    return toCsv(header, rows);
  }

  /** アカウント詳細画面 (指示書13章): 連携ID・外部サービス連携・ウォレット・操作ログ。 */
  async getAccountDetail(accountId: string): Promise<unknown> {
    const account = await this.db.oveAccount.findUnique({
      where: { id: accountId },
      include: {
        wallet: true,
        identities: { orderBy: { createdAt: "desc" } },
        links: { include: { serviceIntegration: { select: { serviceCode: true, serviceName: true } } } },
        mergedIntoAccount: { select: { id: true, accountCode: true } },
        mergedAccounts: { select: { id: true, accountCode: true } },
      },
    });
    if (!account) throw new NotFoundException("account not found");

    const auditLogs = await this.db.auditLog.findMany({
      where: { targetType: "ove_account", targetId: accountId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });

    const activeSessionCount = await this.db.userSession.count({
      where: { oveAccountId: accountId, revokedAt: null, expiresAt: { gt: new Date() } },
    });

    return { ...account, auditLogs, activeSessionCount };
  }

  /** 全セッション無効化 (指示書16章): 端末を問わずアカウントの有効なセッションを一括で失効させる。 */
  async revokeAllSessions(accountId: string, adminId: string): Promise<{ revokedCount: number }> {
    const account = await this.db.oveAccount.findUnique({ where: { id: accountId } });
    if (!account) throw new NotFoundException("account not found");

    const { count } = await this.db.userSession.updateMany({
      where: { oveAccountId: accountId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "ADMIN_FORCED_LOGOUT" },
    });

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: adminId,
        actionType: "ACCOUNT_SESSIONS_REVOKED",
        targetType: "ove_account",
        targetId: accountId,
        result: "SUCCESS",
        afterData: { revokedCount: count },
      },
    });

    return { revokedCount: count };
  }

  /**
   * 既存ユーザー移行 (指示書15章) で残高不明のため `REVIEWING` になったアカウントを、
   * 検証者が調査結果 (確認できた残高) をもとに解消する。推定値の自動付与は一切行わず、
   * 検証者が確認した金額のみを人手で入力させる (残高不明ユーザーに推定残高を入れないという
   * 移行時の原則を、事後確認の場面でも一貫させる)。
   *
   * 職務分離: このアカウントを移行実行時にREVIEWINGにした管理者本人による解消は禁止する
   * (`MIGRATION_SET_REVIEWING` 監査ログで実行者を特定する。移行実行そのものの事前承認制
   * `docs/migration.md`「事前承認制・職務分離」とは別に、事後の検証者フローにも職務分離を
   * 課す)。監査ログが存在しない (この変更より前に作られたREVIEWINGアカウント等) 場合は
   * 実行者を特定できないため、このチェックは行わない。
   */
  async resolveReview(params: {
    accountId: string;
    confirmedBalance: number;
    reason: string;
    verifiedBy: string;
  }): Promise<unknown> {
    const account = await this.db.oveAccount.findUnique({ where: { id: params.accountId }, include: { wallet: true } });
    if (!account) throw new NotFoundException("account not found");
    if (account.status !== "REVIEWING") {
      throw new ConflictException(`account ${params.accountId} is not in REVIEWING status (status=${account.status})`);
    }
    if (!account.wallet) throw new NotFoundException("wallet not found for account");
    if (!Number.isInteger(params.confirmedBalance) || params.confirmedBalance < 0) {
      throw new BadRequestException("confirmedBalance must be a non-negative integer");
    }

    const setReviewingLog = await this.db.auditLog.findFirst({
      where: { targetType: "ove_account", targetId: params.accountId, actionType: "MIGRATION_SET_REVIEWING" },
      orderBy: { createdAt: "desc" },
    });
    if (setReviewingLog && setReviewingLog.actorId === params.verifiedBy) {
      throw new BadRequestException(
        "the verifier must be different from the admin who executed the migration (separation of duties)",
      );
    }

    let transaction: OveTransaction | undefined;
    if (params.confirmedBalance > 0) {
      transaction = await creditWallet(
        {
          walletId: account.wallet.id,
          amount: params.confirmedBalance,
          transactionType: "OPENING_BALANCE",
          idempotencyKey: `MIGRATION_REVIEW_RESOLVED:${params.accountId}`,
          displayName: "旧システムからの移行残高 (検証者確認後)",
          description: params.reason,
          createdByType: "ADMIN",
          createdById: params.verifiedBy,
          metadata: { migrationReviewResolved: true },
        },
        this.db,
      );
    }

    await this.db.oveAccount.update({ where: { id: params.accountId }, data: { status: "ACTIVE" } });

    await this.db.auditLog.create({
      data: {
        id: generateId(),
        actorType: "ADMIN",
        actorId: params.verifiedBy,
        actionType: "MIGRATION_REVIEW_RESOLVED",
        targetType: "ove_account",
        targetId: params.accountId,
        result: "SUCCESS",
        reason: params.reason,
        afterData: { confirmedBalance: params.confirmedBalance },
      },
    });

    return { status: "ACTIVE" as const, transaction: transaction ? serializeTransaction(transaction) : null };
  }

  async listWallets(params: { status?: string; limit?: number }) {
    return this.db.wallet.findMany({
      where: params.status ? { status: params.status as never } : undefined,
      orderBy: { createdAt: "desc" },
      take: Math.min(params.limit ?? 50, 200),
      include: { account: true },
    });
  }

  async getWalletDetail(walletId: string) {
    const wallet = await this.db.wallet.findUnique({
      where: { id: walletId },
      include: { account: true, holds: { orderBy: { createdAt: "desc" }, take: 20 } },
    });
    if (!wallet) throw new NotFoundException("wallet not found");
    const transactions = await this.db.oveTransaction.findMany({
      where: { walletId },
      orderBy: { occurredAt: "desc" },
      take: 50,
    });
    return { ...wallet, recentTransactions: transactions.map(serializeTransaction) };
  }

  /**
   * HIGH_VALUE_THRESHOLD (指示書13章「高額手動付与」) 以上の場合は即時実行せず、
   * 二段階承認の申請を作成して { status: "PENDING_APPROVAL" } を返す。
   */
  async grant(params: { walletId: string; amount: number; reason: string; idempotencyKey?: string; adminId: string }) {
    const amount = BigInt(params.amount);
    const idempotencyKey = params.idempotencyKey ?? `ADMIN_GRANT:${generateId()}`;

    if (amount >= HIGH_VALUE_THRESHOLD) {
      const request = await this.approvals.requestHighValueOperation({
        kind: "HIGH_VALUE_GRANT",
        walletId: params.walletId,
        amount,
        reason: params.reason,
        idempotencyKey,
        requestedBy: params.adminId,
      });
      return { result: "PENDING_APPROVAL" as const, approvalRequestId: request.id };
    }

    const transaction = await creditWallet(
      {
        walletId: params.walletId,
        amount,
        transactionType: "ADMIN_GRANT",
        idempotencyKey,
        displayName: "管理者による個別付与",
        description: params.reason,
        createdByType: "ADMIN",
        createdById: params.adminId,
      },
      this.db,
    );
    return { result: "COMPLETED" as const, transaction: serializeTransaction(transaction) };
  }

  async deduct(params: { walletId: string; amount: number; reason: string; idempotencyKey?: string; adminId: string }) {
    const amount = BigInt(params.amount);
    const idempotencyKey = params.idempotencyKey ?? `ADMIN_DEDUCTION:${generateId()}`;

    if (amount >= HIGH_VALUE_THRESHOLD) {
      const request = await this.approvals.requestHighValueOperation({
        kind: "HIGH_VALUE_DEDUCTION",
        walletId: params.walletId,
        amount,
        reason: params.reason,
        idempotencyKey,
        requestedBy: params.adminId,
      });
      return { result: "PENDING_APPROVAL" as const, approvalRequestId: request.id };
    }

    const transaction = await debitWallet(
      {
        walletId: params.walletId,
        amount,
        transactionType: "ADMIN_DEDUCTION",
        idempotencyKey,
        displayName: "管理者による個別減算",
        description: params.reason,
        createdByType: "ADMIN",
        createdById: params.adminId,
      },
      this.db,
    );
    return { result: "COMPLETED" as const, transaction: serializeTransaction(transaction) };
  }

  async reverse(params: { transactionId: string; reason: string; idempotencyKey?: string; adminId: string }) {
    const transaction = await reverseTransaction(
      {
        transactionId: params.transactionId,
        reason: params.reason,
        idempotencyKey: params.idempotencyKey ?? `ADMIN_REVERSAL:${generateId()}`,
        createdByType: "ADMIN",
        createdById: params.adminId,
      },
      this.db,
    );
    return serializeTransaction(transaction);
  }

  async hold(params: { walletId: string; amount: number; reason: string; idempotencyKey?: string; adminId: string }) {
    return holdBalance(
      {
        walletId: params.walletId,
        amount: params.amount,
        reason: params.reason,
        idempotencyKey: params.idempotencyKey ?? `ADMIN_HOLD:${generateId()}`,
        createdBy: params.adminId,
      },
      this.db,
    );
  }

  async release(params: { holdId: string; idempotencyKey?: string; adminId: string }) {
    const transaction = await releaseHold(
      {
        holdId: params.holdId,
        idempotencyKey: params.idempotencyKey ?? `ADMIN_RELEASE:${generateId()}`,
        createdBy: params.adminId,
      },
      this.db,
    );
    return serializeTransaction(transaction);
  }

  /** 取引一覧 (全ウォレット横断)。管理画面の「取引一覧」画面から使う。 */
  async listTransactions(params: {
    accountCode?: string;
    transactionType?: string;
    status?: string;
    direction?: string;
    limit?: number;
  }) {
    const wallet = params.accountCode
      ? await this.db.wallet.findFirst({ where: { account: { accountCode: params.accountCode } } })
      : undefined;
    if (params.accountCode && !wallet) return [];

    const transactions = await this.db.oveTransaction.findMany({
      where: {
        walletId: wallet?.id,
        transactionType: params.transactionType ? (params.transactionType as never) : undefined,
        status: params.status ? (params.status as never) : undefined,
        direction: params.direction ? (params.direction as never) : undefined,
      },
      include: { wallet: { include: { account: true } } },
      orderBy: { occurredAt: "desc" },
      take: Math.min(params.limit ?? 100, 500),
    });

    return transactions.map((t) => ({
      ...serializeTransaction(t),
      account_code: t.wallet.account.accountCode,
    }));
  }

  async listAuditLogs(params: { targetType?: string; limit?: number }): Promise<unknown[]> {
    return this.db.auditLog.findMany({
      where: params.targetType ? { targetType: params.targetType } : undefined,
      orderBy: { createdAt: "desc" },
      take: Math.min(params.limit ?? 100, 500),
    });
  }

  /**
   * 監査ログCSVエクスポート (docs/admin-operations.md参照)。画面の一覧 (500件上限)
   * とは別に、直近10,000件を上限として返す (`docs/transaction-export.md`と同じ方針)。
   */
  async exportAuditLogsCsv(params: { targetType?: string }): Promise<string> {
    const logs = await this.db.auditLog.findMany({
      where: params.targetType ? { targetType: params.targetType } : undefined,
      orderBy: { createdAt: "desc" },
      take: 10000,
    });

    const header = ["日時", "実行者種別", "実行者ID", "操作種別", "対象種別", "対象ID", "結果", "理由", "IPアドレス"];
    const rows = logs.map((l) => [
      l.createdAt.toISOString(),
      l.actorType,
      l.actorId ?? "",
      l.actionType,
      l.targetType,
      l.targetId ?? "",
      l.result,
      l.reason ?? "",
      l.ipAddress ?? "",
    ]);

    return toCsv(header, rows);
  }

  /** 指示書13章「APIアクセスログ」画面: 外部サービスAPIへのリクエスト履歴。 */
  async listApiAccessLogs(params: {
    serviceIntegrationId?: string;
    statusCode?: number;
    limit?: number;
  }): Promise<unknown[]> {
    const logs = await this.db.apiAccessLog.findMany({
      where: {
        serviceIntegrationId: params.serviceIntegrationId,
        statusCode: params.statusCode,
      },
      include: { serviceIntegration: { select: { serviceCode: true, serviceName: true } } },
      orderBy: { createdAt: "desc" },
      take: Math.min(params.limit ?? 100, 500),
    });

    return logs.map((log) => ({
      ...log,
      serviceCode: log.serviceIntegration?.serviceCode ?? null,
      serviceName: log.serviceIntegration?.serviceName ?? null,
      serviceIntegration: undefined,
    }));
  }

  /** 指示書17章: 定期整合性チェック。不一致は自動修正せず一覧を返す。 */
  async reconcile() {
    const results = await reconcileAllWallets(this.db);
    const mismatched = results.filter((r) => !r.isConsistent);
    return {
      checkedWalletCount: results.length,
      mismatchedWalletCount: mismatched.length,
      mismatched: mismatched.map((r) => ({
        walletId: r.walletId,
        walletCode: r.walletCode,
        computedBalance: r.computedBalance.toString(),
        cachedBalance: r.cachedBalance.toString(),
        difference: r.difference.toString(),
      })),
    };
  }
}
