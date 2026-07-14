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

@Injectable()
export class AdminService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

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

  async grant(params: { walletId: string; amount: number; reason: string; idempotencyKey?: string; adminId: string }) {
    const transaction = await creditWallet(
      {
        walletId: params.walletId,
        amount: params.amount,
        transactionType: "ADMIN_GRANT",
        idempotencyKey: params.idempotencyKey ?? `ADMIN_GRANT:${generateId()}`,
        displayName: "管理者による個別付与",
        description: params.reason,
        createdByType: "ADMIN",
        createdById: params.adminId,
      },
      this.db,
    );
    return serializeTransaction(transaction);
  }

  async deduct(params: { walletId: string; amount: number; reason: string; idempotencyKey?: string; adminId: string }) {
    const transaction = await debitWallet(
      {
        walletId: params.walletId,
        amount: params.amount,
        transactionType: "ADMIN_DEDUCTION",
        idempotencyKey: params.idempotencyKey ?? `ADMIN_DEDUCTION:${generateId()}`,
        displayName: "管理者による個別減算",
        description: params.reason,
        createdByType: "ADMIN",
        createdById: params.adminId,
      },
      this.db,
    );
    return serializeTransaction(transaction);
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
