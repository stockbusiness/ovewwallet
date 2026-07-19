import {
  prisma as defaultPrisma,
  generateId,
  nextDisplayCode,
  TRANSACTION_CODE_COUNTER,
  type OveTransaction,
  type PrismaClient,
  type CreatedByType,
  type TransactionType,
  type Prisma,
} from "@ove/database";
import { InsufficientBalanceError, WalletNotFoundError } from "./errors";
import {
  assertWalletActive,
  consumeCreditLotsFifo,
  isUniqueConstraintError,
  lockWallet,
  toPositiveBigInt,
} from "./util";

type Db = PrismaClient;

export interface CreditWalletParams {
  walletId: string;
  amount: bigint | number;
  transactionType: TransactionType;
  idempotencyKey: string;
  displayName: string;
  description?: string;
  sourceService?: string;
  sourceReferenceId?: string;
  createdByType: CreatedByType;
  createdById?: string;
  metadata?: Prisma.InputJsonValue;
  /**
   * 指定した日時が過ぎたCREDIT分をOVE有効期限バッチの対象にする
   * (docs/credit-expiry.md参照)。付与ルールに `expiry_days` が設定されて
   * いる場合のみ呼び出し元が計算して渡す。未指定なら失効しない。
   */
  expiresAt?: Date;
}

/**
 * 台帳へのCREDIT記帳。指示書8章の必須ルール (行ロック・重複確認・原子性) を
 * 1つのDBトランザクション内で満たす。
 */
export async function creditWallet(
  params: CreditWalletParams,
  db: Db = defaultPrisma,
): Promise<OveTransaction> {
  const amount = toPositiveBigInt(params.amount);

  const existing = await db.oveTransaction.findUnique({
    where: { idempotencyKey: params.idempotencyKey },
  });
  if (existing) return existing;

  try {
    return await db.$transaction(async (tx) => {
      const wallet = await lockWallet(tx, params.walletId);
      if (!wallet) throw new WalletNotFoundError(params.walletId);
      assertWalletActive(wallet);

      const balanceBefore = wallet.availableBalance;
      const balanceAfter = balanceBefore + amount;
      const transactionCode = await nextDisplayCode(tx, TRANSACTION_CODE_COUNTER, "OVE-TXN");

      const created = await tx.oveTransaction.create({
        data: {
          id: generateId(),
          walletId: wallet.id,
          transactionCode,
          transactionType: params.transactionType,
          direction: "CREDIT",
          amount,
          status: "COMPLETED",
          balanceBefore,
          balanceAfter,
          displayName: params.displayName,
          description: params.description,
          sourceService: params.sourceService,
          sourceReferenceId: params.sourceReferenceId,
          idempotencyKey: params.idempotencyKey,
          occurredAt: new Date(),
          completedAt: new Date(),
          createdByType: params.createdByType,
          createdById: params.createdById,
          metadata: params.metadata,
        },
      });

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: balanceAfter,
          lifetimeCredited: { increment: amount },
        },
      });

      if (params.expiresAt) {
        await tx.oveCreditLot.create({
          data: {
            id: generateId(),
            walletId: wallet.id,
            transactionId: created.id,
            amount,
            remainingAmount: amount,
            expiresAt: params.expiresAt,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          id: generateId(),
          actorType: params.createdByType,
          actorId: params.createdById,
          actionType: "LEDGER_CREDIT",
          targetType: "wallet",
          targetId: wallet.id,
          result: "SUCCESS",
          afterData: {
            transactionId: created.id,
            amount: amount.toString(),
            balanceAfter: balanceAfter.toString(),
          },
        },
      });

      return created;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const race = await db.oveTransaction.findUnique({
        where: { idempotencyKey: params.idempotencyKey },
      });
      if (race) return race;
    }
    throw error;
  }
}

export interface DebitWalletParams {
  walletId: string;
  amount: bigint | number;
  transactionType: TransactionType;
  idempotencyKey: string;
  displayName: string;
  description?: string;
  sourceService?: string;
  sourceReferenceId?: string;
  createdByType: CreatedByType;
  createdById?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * 台帳へのDEBIT記帳。利用可能残高を下回る場合は必ず拒否し (マイナス残高禁止)、
 * 拒否理由は監査ログにのみ残す (残高・取引レコードは一切変更しない)。
 */
export async function debitWallet(
  params: DebitWalletParams,
  db: Db = defaultPrisma,
): Promise<OveTransaction> {
  const amount = toPositiveBigInt(params.amount);

  const existing = await db.oveTransaction.findUnique({
    where: { idempotencyKey: params.idempotencyKey },
  });
  if (existing) return existing;

  try {
    return await db.$transaction(async (tx) => {
      const wallet = await lockWallet(tx, params.walletId);
      if (!wallet) throw new WalletNotFoundError(params.walletId);
      assertWalletActive(wallet);

      if (wallet.availableBalance < amount) {
        throw new InsufficientBalanceError(wallet.id, wallet.availableBalance, amount);
      }

      const balanceBefore = wallet.availableBalance;
      const balanceAfter = balanceBefore - amount;
      const transactionCode = await nextDisplayCode(tx, TRANSACTION_CODE_COUNTER, "OVE-TXN");

      const created = await tx.oveTransaction.create({
        data: {
          id: generateId(),
          walletId: wallet.id,
          transactionCode,
          transactionType: params.transactionType,
          direction: "DEBIT",
          amount,
          status: "COMPLETED",
          balanceBefore,
          balanceAfter,
          displayName: params.displayName,
          description: params.description,
          sourceService: params.sourceService,
          sourceReferenceId: params.sourceReferenceId,
          idempotencyKey: params.idempotencyKey,
          occurredAt: new Date(),
          completedAt: new Date(),
          createdByType: params.createdByType,
          createdById: params.createdById,
          metadata: params.metadata,
        },
      });

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: balanceAfter,
          lifetimeDebited: { increment: amount },
        },
      });

      // 有効期限が近いロットから優先的に消費する (対象ロットが無ければ何もしない)。
      await consumeCreditLotsFifo(tx, wallet.id, amount);

      await tx.auditLog.create({
        data: {
          id: generateId(),
          actorType: params.createdByType,
          actorId: params.createdById,
          actionType: "LEDGER_DEBIT",
          targetType: "wallet",
          targetId: wallet.id,
          result: "SUCCESS",
          afterData: {
            transactionId: created.id,
            amount: amount.toString(),
            balanceAfter: balanceAfter.toString(),
          },
        },
      });

      return created;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const race = await db.oveTransaction.findUnique({
        where: { idempotencyKey: params.idempotencyKey },
      });
      if (race) return race;
    }
    if (error instanceof InsufficientBalanceError) {
      await db.auditLog.create({
        data: {
          id: generateId(),
          actorType: params.createdByType,
          actorId: params.createdById,
          actionType: "LEDGER_DEBIT_REJECTED",
          targetType: "wallet",
          targetId: params.walletId,
          result: "FAILURE",
          reason: error.message,
        },
      });
    }
    throw error;
  }
}
