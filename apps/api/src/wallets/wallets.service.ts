import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrismaClient } from "@ove/database";
import { getWalletBalance, listWalletTransactions } from "@ove/ledger";
import { PRISMA } from "../common/prisma.module";

@Injectable()
export class WalletsService {
  constructor(@Inject(PRISMA) private readonly db: PrismaClient) {}

  private async requireWalletForAccount(oveAccountId: string) {
    const wallet = await this.db.wallet.findUnique({ where: { oveAccountId } });
    if (!wallet) throw new NotFoundException("wallet not found for this account");
    return wallet;
  }

  async getBalance(oveAccountId: string) {
    const wallet = await this.requireWalletForAccount(oveAccountId);
    const fresh = await getWalletBalance(wallet.id, this.db);
    return {
      ove_account_id: oveAccountId,
      wallet_id: fresh.id,
      wallet_code: fresh.walletCode,
      status: fresh.status,
      available_balance: fresh.availableBalance.toString(),
      pending_balance: fresh.pendingBalance.toString(),
      held_balance: fresh.heldBalance.toString(),
      lifetime_credited: fresh.lifetimeCredited.toString(),
      lifetime_debited: fresh.lifetimeDebited.toString(),
    };
  }

  async listTransactions(oveAccountId: string, limit?: number, before?: string) {
    const wallet = await this.requireWalletForAccount(oveAccountId);
    const rows = await listWalletTransactions(
      wallet.id,
      { limit, before: before ? new Date(before) : undefined },
      this.db,
    );
    return rows.map(serializeTransaction);
  }

  /** 取引詳細画面 (指示書13章) 用。本人のウォレットに属する取引のみ取得できる。 */
  async getTransaction(oveAccountId: string, transactionId: string) {
    const wallet = await this.requireWalletForAccount(oveAccountId);
    const transaction = await this.db.oveTransaction.findFirst({
      where: { id: transactionId, walletId: wallet.id },
    });
    if (!transaction) throw new NotFoundException("transaction not found");
    return serializeTransaction(transaction);
  }
}

export function serializeTransaction(t: {
  id: string;
  transactionCode: string;
  walletId: string;
  transactionType: string;
  direction: string;
  amount: bigint;
  status: string;
  balanceBefore: bigint;
  balanceAfter: bigint;
  displayName: string;
  description: string | null;
  sourceService?: string | null;
  sourceReferenceId?: string | null;
  relatedTransactionId?: string | null;
  occurredAt: Date;
  completedAt: Date | null;
}) {
  return {
    id: t.id,
    transaction_code: t.transactionCode,
    wallet_id: t.walletId,
    transaction_type: t.transactionType,
    direction: t.direction,
    amount: t.amount.toString(),
    status: t.status,
    balance_before: t.balanceBefore.toString(),
    balance_after: t.balanceAfter.toString(),
    display_name: t.displayName,
    description: t.description,
    source_service: t.sourceService ?? null,
    source_reference_id: t.sourceReferenceId ?? null,
    related_transaction_id: t.relatedTransactionId ?? null,
    occurred_at: t.occurredAt.toISOString(),
    completed_at: t.completedAt ? t.completedAt.toISOString() : null,
  };
}
