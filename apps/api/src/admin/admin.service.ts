import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { generateId, type PrismaClient } from "@ove/database";
import {
  creditWallet,
  debitWallet,
  holdBalance,
  releaseHold,
  reconcileAllWallets,
  reverseTransaction,
} from "@ove/ledger";
import { PRISMA } from "../common/prisma.module";
import { serializeTransaction } from "../wallets/wallets.service";
import { AdminApprovalService, HIGH_VALUE_THRESHOLD } from "./admin-approval.service";

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

  async listAccounts(params: { status?: string; limit?: number }) {
    return this.db.oveAccount.findMany({
      where: params.status ? { status: params.status as never } : undefined,
      orderBy: { createdAt: "desc" },
      take: Math.min(params.limit ?? 50, 200),
      include: { wallet: true },
    });
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

    return { ...account, auditLogs };
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
