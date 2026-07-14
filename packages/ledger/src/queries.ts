import { prisma as defaultPrisma, type OveTransaction, type PrismaClient, type Wallet } from "@ove/database";
import { WalletNotFoundError } from "./errors";

type Db = PrismaClient;

export async function getWalletBalance(walletId: string, db: Db = defaultPrisma): Promise<Wallet> {
  const wallet = await db.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) throw new WalletNotFoundError(walletId);
  return wallet;
}

export interface ListTransactionsOptions {
  limit?: number;
  before?: Date;
}

export async function listWalletTransactions(
  walletId: string,
  options: ListTransactionsOptions = {},
  db: Db = defaultPrisma,
): Promise<OveTransaction[]> {
  const limit = Math.min(options.limit ?? 20, 100);
  return db.oveTransaction.findMany({
    where: {
      walletId,
      ...(options.before ? { occurredAt: { lt: options.before } } : {}),
    },
    orderBy: { occurredAt: "desc" },
    take: limit,
  });
}
