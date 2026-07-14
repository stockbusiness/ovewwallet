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

  async listAccounts(params: { status?: string; limit?: number }) {
    return this.db.oveAccount.findMany({
      where: params.status ? { status: params.status as never } : undefined,
      orderBy: { createdAt: "desc" },
      take: Math.min(params.limit ?? 50, 200),
      include: { wallet: true },
    });
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
