import {
  prisma as defaultPrisma,
  generateId,
  nextDisplayCode,
  TRANSACTION_CODE_COUNTER,
  type PrismaClient,
} from "@ove/database";
import { lockWallet } from "./util";

type Db = PrismaClient;

export interface ExpireDueCreditLotsResult {
  /** 失効処理を実行したウォレット数 (失効対象が無かったウォレットは含まない) */
  walletsProcessed: number;
  /** 失効させた合計OVE量 (すべてのウォレット合算) */
  totalExpiredAmount: bigint;
}

/**
 * 有効期限が到来した ove_credit_lots を失効させるバッチ処理。
 * ウォレットごとに以下を行う (docs/credit-expiry.md参照):
 * 1. 期限切れ・未失効・未消費のロットを集計
 * 2. 現在のavailable_balanceを超えない範囲でEXPIRATION(DEBIT)取引を1件作成
 *    (すでに使い切られている分は失効させない。整合性チェックで残高がマイナスに
 *    ならないことを優先する)
 * 3. 対象ロットをexpired_at設定・remaining_amount=0に更新
 *
 * cron等の外部スケジューラから定期実行することを想定 (このリポジトリには
 * スケジューラ自体は含まれていない。docs/credit-expiry.md「運用」参照)。
 */
export async function expireDueCreditLots(
  db: Db = defaultPrisma,
  now: Date = new Date(),
): Promise<ExpireDueCreditLotsResult> {
  const dueWallets = await db.oveCreditLot.findMany({
    where: { expiresAt: { lte: now }, expiredAt: null, voidedAt: null, remainingAmount: { gt: 0n } },
    select: { walletId: true },
    distinct: ["walletId"],
  });

  let walletsProcessed = 0;
  let totalExpiredAmount = 0n;

  for (const { walletId } of dueWallets) {
    const expiredAmount = await db.$transaction(async (tx) => {
      const wallet = await lockWallet(tx, walletId);
      if (!wallet) return 0n;

      const lots = await tx.oveCreditLot.findMany({
        where: { walletId, expiresAt: { lte: now }, expiredAt: null, voidedAt: null, remainingAmount: { gt: 0n } },
      });
      if (lots.length === 0) return 0n;

      const due = lots.reduce((sum, lot) => sum + lot.remainingAmount, 0n);
      const expireAmount = due < wallet.availableBalance ? due : wallet.availableBalance;
      if (expireAmount <= 0n) return 0n;

      const balanceBefore = wallet.availableBalance;
      const balanceAfter = balanceBefore - expireAmount;
      const transactionCode = await nextDisplayCode(tx, TRANSACTION_CODE_COUNTER, "OVE-TXN");

      await tx.oveTransaction.create({
        data: {
          id: generateId(),
          walletId,
          transactionCode,
          transactionType: "EXPIRATION",
          direction: "DEBIT",
          amount: expireAmount,
          status: "COMPLETED",
          balanceBefore,
          balanceAfter,
          displayName: "OVE失効",
          description: `有効期限切れにより${lots.length}件のポイントが失効しました`,
          idempotencyKey: generateId(),
          occurredAt: now,
          completedAt: now,
          createdByType: "SYSTEM",
          metadata: { lotIds: lots.map((l) => l.id) },
        },
      });

      await tx.wallet.update({
        where: { id: walletId },
        data: { availableBalance: balanceAfter, lifetimeDebited: { increment: expireAmount } },
      });

      await tx.oveCreditLot.updateMany({
        where: { id: { in: lots.map((l) => l.id) } },
        data: { expiredAt: now, remainingAmount: 0n },
      });

      await tx.auditLog.create({
        data: {
          id: generateId(),
          actorType: "SYSTEM",
          actionType: "LEDGER_EXPIRATION",
          targetType: "wallet",
          targetId: walletId,
          result: "SUCCESS",
          afterData: { expiredAmount: expireAmount.toString(), lotCount: lots.length },
        },
      });

      return expireAmount;
    });

    if (expiredAmount > 0n) {
      walletsProcessed += 1;
      totalExpiredAmount += expiredAmount;
    }
  }

  return { walletsProcessed, totalExpiredAmount };
}

/**
 * `expireDueCreditLots`を実行した場合に何が起こるかを、書き込みを行わずに事前確認する
 * (docs/credit-expiry.md「失効予告レポート」参照)。管理画面の失効バッチ実行ボタンの
 * 直前に影響範囲を確認できるようにする狙い。判定条件・利用可能残高によるキャップは
 * `expireDueCreditLots`と同一にしている (実行結果とプレビューがずれないようにするため)。
 */
export async function previewExpiringCreditLots(
  db: Db = defaultPrisma,
  now: Date = new Date(),
): Promise<ExpireDueCreditLotsResult> {
  const dueWallets = await db.oveCreditLot.findMany({
    where: { expiresAt: { lte: now }, expiredAt: null, voidedAt: null, remainingAmount: { gt: 0n } },
    select: { walletId: true },
    distinct: ["walletId"],
  });

  let walletsProcessed = 0;
  let totalExpiredAmount = 0n;

  for (const { walletId } of dueWallets) {
    const wallet = await db.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) continue;

    const lots = await db.oveCreditLot.findMany({
      where: { walletId, expiresAt: { lte: now }, expiredAt: null, voidedAt: null, remainingAmount: { gt: 0n } },
    });
    const due = lots.reduce((sum, lot) => sum + lot.remainingAmount, 0n);
    const expireAmount = due < wallet.availableBalance ? due : wallet.availableBalance;
    if (expireAmount <= 0n) continue;

    walletsProcessed += 1;
    totalExpiredAmount += expireAmount;
  }

  return { walletsProcessed, totalExpiredAmount };
}
