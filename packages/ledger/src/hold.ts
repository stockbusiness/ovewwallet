import {
  prisma as defaultPrisma,
  generateId,
  nextDisplayCode,
  TRANSACTION_CODE_COUNTER,
  type OveTransaction,
  type WalletHold,
  type PrismaClient,
} from "@ove/database";
import {
  HoldNotActiveError,
  HoldNotFoundError,
  InsufficientBalanceError,
  WalletNotFoundError,
} from "./errors";
import { assertWalletActive, isUniqueConstraintError, lockWallet, toPositiveBigInt } from "./util";

type Db = PrismaClient;

function extractHoldId(metadata: unknown): string | undefined {
  if (metadata && typeof metadata === "object" && "walletHoldId" in metadata) {
    const value = (metadata as Record<string, unknown>).walletHoldId;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

export interface HoldBalanceParams {
  walletId: string;
  amount: bigint | number;
  reason: string;
  idempotencyKey: string;
  createdBy: string;
}

/**
 * 残高保留。available_balance から amount を減らし held_balance へ積む。
 * 対応する ove_transactions 行は status=HELD とし、整合性チェック (17章) の
 * COMPLETED取引合計には含めない。
 */
export async function holdBalance(
  params: HoldBalanceParams,
  db: Db = defaultPrisma,
): Promise<WalletHold> {
  const amount = toPositiveBigInt(params.amount);

  const existingTxn = await db.oveTransaction.findUnique({
    where: { idempotencyKey: params.idempotencyKey },
  });
  if (existingTxn) {
    const holdId = extractHoldId(existingTxn.metadata);
    if (holdId) {
      const hold = await db.walletHold.findUnique({ where: { id: holdId } });
      if (hold) return hold;
    }
  }

  try {
    return await db.$transaction(async (tx) => {
      const wallet = await lockWallet(tx, params.walletId);
      if (!wallet) throw new WalletNotFoundError(params.walletId);
      assertWalletActive(wallet);

      if (wallet.availableBalance < amount) {
        throw new InsufficientBalanceError(wallet.id, wallet.availableBalance, amount);
      }

      const holdId = generateId();
      const balanceBefore = wallet.availableBalance;
      const balanceAfter = balanceBefore - amount;
      const transactionCode = await nextDisplayCode(tx, TRANSACTION_CODE_COUNTER, "OVE-TXN");

      await tx.oveTransaction.create({
        data: {
          id: generateId(),
          walletId: wallet.id,
          transactionCode,
          transactionType: "HOLD",
          direction: "DEBIT",
          amount,
          status: "HELD",
          balanceBefore,
          balanceAfter,
          displayName: "残高保留",
          description: params.reason,
          idempotencyKey: params.idempotencyKey,
          occurredAt: new Date(),
          createdByType: "ADMIN",
          createdById: params.createdBy,
          metadata: { walletHoldId: holdId },
        },
      });

      const hold = await tx.walletHold.create({
        data: {
          id: holdId,
          walletId: wallet.id,
          amount,
          reason: params.reason,
          status: "HELD",
          heldAt: new Date(),
          createdBy: params.createdBy,
        },
      });

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: balanceAfter,
          heldBalance: { increment: amount },
        },
      });

      await tx.auditLog.create({
        data: {
          id: generateId(),
          actorType: "ADMIN",
          actorId: params.createdBy,
          actionType: "WALLET_HOLD",
          targetType: "wallet",
          targetId: wallet.id,
          result: "SUCCESS",
          reason: params.reason,
          afterData: { holdId, amount: amount.toString() },
        },
      });

      return hold;
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      const race = await db.oveTransaction.findUnique({
        where: { idempotencyKey: params.idempotencyKey },
      });
      const holdId = race ? extractHoldId(race.metadata) : undefined;
      if (holdId) {
        const hold = await db.walletHold.findUnique({ where: { id: holdId } });
        if (hold) return hold;
      }
    }
    throw error;
  }
}

export interface ReleaseHoldParams {
  holdId: string;
  idempotencyKey: string;
  createdBy: string;
}

/** 保留解除。held_balance から available_balance へ戻し、RELEASE取引を追加する。 */
export async function releaseHold(
  params: ReleaseHoldParams,
  db: Db = defaultPrisma,
): Promise<OveTransaction> {
  const existing = await db.oveTransaction.findUnique({
    where: { idempotencyKey: params.idempotencyKey },
  });
  if (existing) return existing;

  try {
    return await db.$transaction(async (tx) => {
      const hold = await tx.walletHold.findUnique({ where: { id: params.holdId } });
      if (!hold) throw new HoldNotFoundError(params.holdId);
      if (hold.status !== "HELD") throw new HoldNotActiveError(hold.id, hold.status);

      const wallet = await lockWallet(tx, hold.walletId);
      if (!wallet) throw new WalletNotFoundError(hold.walletId);

      const balanceBefore = wallet.availableBalance;
      const balanceAfter = balanceBefore + hold.amount;
      const transactionCode = await nextDisplayCode(tx, TRANSACTION_CODE_COUNTER, "OVE-TXN");

      const releaseTxn = await tx.oveTransaction.create({
        data: {
          id: generateId(),
          walletId: wallet.id,
          transactionCode,
          transactionType: "RELEASE",
          direction: "CREDIT",
          amount: hold.amount,
          status: "COMPLETED",
          balanceBefore,
          balanceAfter,
          displayName: "保留解除",
          description: `hold:${hold.id}`,
          idempotencyKey: params.idempotencyKey,
          occurredAt: new Date(),
          completedAt: new Date(),
          createdByType: "ADMIN",
          createdById: params.createdBy,
          metadata: { walletHoldId: hold.id },
        },
      });

      await tx.walletHold.update({
        where: { id: hold.id },
        data: { status: "RELEASED", releasedAt: new Date() },
      });

      await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          availableBalance: balanceAfter,
          heldBalance: { decrement: hold.amount },
        },
      });

      await tx.auditLog.create({
        data: {
          id: generateId(),
          actorType: "ADMIN",
          actorId: params.createdBy,
          actionType: "WALLET_HOLD_RELEASE",
          targetType: "wallet",
          targetId: wallet.id,
          result: "SUCCESS",
          afterData: { holdId: hold.id, releaseTransactionId: releaseTxn.id },
        },
      });

      return releaseTxn;
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
