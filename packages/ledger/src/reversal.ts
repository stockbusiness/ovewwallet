import {
  prisma as defaultPrisma,
  generateId,
  nextDisplayCode,
  TRANSACTION_CODE_COUNTER,
  type OveTransaction,
  type PrismaClient,
  type CreatedByType,
} from "@ove/database";
import {
  InsufficientBalanceError,
  TransactionNotFoundError,
  TransactionNotReversibleError,
  WalletNotFoundError,
} from "./errors";
import { isUniqueConstraintError, lockWallet } from "./util";

type Db = PrismaClient;

export interface ReverseTransactionParams {
  transactionId: string;
  reason: string;
  idempotencyKey: string;
  createdByType: CreatedByType;
  createdById?: string;
}

/**
 * COMPLETED取引の取消。元取引は削除・上書きせず、逆方向の REVERSAL 取引を
 * 追加し、元取引のステータスのみ REVERSED に遷移させる (金額・種別・理由は不変)。
 *
 * `transactionId`の存在確認そのものはロック取得前に行うが (どのウォレットを
 * ロックすべきか決めるために必要)、`status`/`alreadyReversed`の判定は必ず
 * ウォレットのロック取得後に再読込した値で行う。異なるidempotencyKeyを持つ
 * 2つのreverseTransaction呼び出しが同じtransactionIdへ同時に来た場合、
 * releaseHold()と同じ理由 (詳細はhold.tsのコメント参照) で、ロック取得前の
 * 判定結果をそのまま使うと後発が二重に取消処理を適用してしまう。
 */
export async function reverseTransaction(
  params: ReverseTransactionParams,
  db: Db = defaultPrisma,
): Promise<OveTransaction> {
  const existing = await db.oveTransaction.findUnique({
    where: { idempotencyKey: params.idempotencyKey },
  });
  if (existing) return existing;

  try {
    return await db.$transaction(async (tx) => {
      const initial = await tx.oveTransaction.findUnique({
        where: { id: params.transactionId },
      });
      if (!initial) throw new TransactionNotFoundError(params.transactionId);

      const wallet = await lockWallet(tx, initial.walletId);
      if (!wallet) throw new WalletNotFoundError(initial.walletId);

      // ロック取得後に再読込して判定する (上記コメント参照)。
      const original = await tx.oveTransaction.findUniqueOrThrow({
        where: { id: params.transactionId },
      });
      if (original.status !== "COMPLETED") {
        throw new TransactionNotReversibleError(original.id, original.status);
      }

      const alreadyReversed = await tx.oveTransaction.findFirst({
        where: { relatedTransactionId: original.id, transactionType: "REVERSAL" },
      });
      if (alreadyReversed) return alreadyReversed;

      const reversalDirection = original.direction === "CREDIT" ? "DEBIT" : "CREDIT";
      const amount = original.amount;

      if (reversalDirection === "DEBIT" && wallet.availableBalance < amount) {
        throw new InsufficientBalanceError(wallet.id, wallet.availableBalance, amount);
      }

      const balanceBefore = wallet.availableBalance;
      const balanceAfter =
        reversalDirection === "CREDIT" ? balanceBefore + amount : balanceBefore - amount;
      const transactionCode = await nextDisplayCode(tx, TRANSACTION_CODE_COUNTER, "OVE-TXN");

      const reversal = await tx.oveTransaction.create({
        data: {
          id: generateId(),
          walletId: wallet.id,
          transactionCode,
          transactionType: "REVERSAL",
          direction: reversalDirection,
          amount,
          status: "COMPLETED",
          balanceBefore,
          balanceAfter,
          displayName: `取消: ${original.displayName}`,
          description: params.reason,
          sourceService: original.sourceService,
          sourceReferenceId: original.sourceReferenceId,
          relatedTransactionId: original.id,
          idempotencyKey: params.idempotencyKey,
          occurredAt: new Date(),
          completedAt: new Date(),
          createdByType: params.createdByType,
          createdById: params.createdById,
          metadata: { reversalReason: params.reason },
        },
      });

      // ステータス遷移のみ (COMPLETED -> REVERSED)。金額・種別・理由は変更しない。
      await tx.oveTransaction.update({
        where: { id: original.id },
        data: { status: "REVERSED" },
      });

      await tx.wallet.update({
        where: { id: wallet.id },
        data:
          reversalDirection === "CREDIT"
            ? { availableBalance: balanceAfter, lifetimeCredited: { increment: amount } }
            : { availableBalance: balanceAfter, lifetimeDebited: { increment: amount } },
      });

      // 元取引がCREDITなら、対応する失効ロットを無効化する (取消により入金自体が
      // 無かったことになるため、残額に関わらずロットごと消費・失効対象から外す)。
      if (original.direction === "CREDIT") {
        await tx.oveCreditLot.updateMany({
          where: { transactionId: original.id, voidedAt: null, expiredAt: null },
          data: { voidedAt: new Date(), remainingAmount: 0n },
        });
      }

      await tx.auditLog.create({
        data: {
          id: generateId(),
          actorType: params.createdByType,
          actorId: params.createdById,
          actionType: "LEDGER_REVERSAL",
          targetType: "ove_transaction",
          targetId: original.id,
          result: "SUCCESS",
          reason: params.reason,
          afterData: { reversalTransactionId: reversal.id, balanceAfter: balanceAfter.toString() },
        },
      });

      return reversal;
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
