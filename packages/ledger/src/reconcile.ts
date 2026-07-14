import { prisma as defaultPrisma, type PrismaClient } from "@ove/database";
import { WalletNotFoundError } from "./errors";

type Db = PrismaClient;

export interface ReconciliationResult {
  walletId: string;
  walletCode: string;
  /** COMPLETED取引のCREDIT合計 - COMPLETED取引のDEBIT合計 - 保留対象 */
  computedBalance: bigint;
  cachedBalance: bigint;
  difference: bigint;
  isConsistent: boolean;
  checkedAt: Date;
}

/**
 * 指示書17章の定期整合性チェック。
 * ウォレット表示残高 ＝ COMPLETED取引のCREDIT合計 － COMPLETED取引のDEBIT合計 － 保留対象
 * 不一致があっても自動修正はしない (呼び出し側でアラートを作成すること)。
 */
export async function reconcileWallet(walletId: string, db: Db = defaultPrisma): Promise<ReconciliationResult> {
  const wallet = await db.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) throw new WalletNotFoundError(walletId);

  // REVERSED は「取消済みだが実際に発生した取引」を表すステータスであり、
  // 取消分は別の REVERSAL 取引 (COMPLETED) として既に記録されている。
  // そのためどちらも合計に含めないと、取消のたびに残高が過大計上されてしまう。
  //
  // HOLD / RELEASE は「保留対象」として wallet.heldBalance 側で別枠管理するため、
  // CREDIT/DEBIT合計には含めない。含めてしまうと保留解除のたびに RELEASE (COMPLETED
  // CREDIT) だけが合計に計上され、対になる HOLD (status=HELD で恒久的に除外) と
  // 非対称になって残高が過大計上される。
  const [creditSum, debitSum] = await Promise.all([
    db.oveTransaction.aggregate({
      where: {
        walletId,
        status: { in: ["COMPLETED", "REVERSED"] },
        direction: "CREDIT",
        transactionType: { notIn: ["HOLD", "RELEASE"] },
      },
      _sum: { amount: true },
    }),
    db.oveTransaction.aggregate({
      where: {
        walletId,
        status: { in: ["COMPLETED", "REVERSED"] },
        direction: "DEBIT",
        transactionType: { notIn: ["HOLD", "RELEASE"] },
      },
      _sum: { amount: true },
    }),
  ]);

  const computedBalance =
    (creditSum._sum.amount ?? 0n) - (debitSum._sum.amount ?? 0n) - wallet.heldBalance;
  const difference = wallet.availableBalance - computedBalance;

  return {
    walletId: wallet.id,
    walletCode: wallet.walletCode,
    computedBalance,
    cachedBalance: wallet.availableBalance,
    difference,
    isConsistent: difference === 0n,
    checkedAt: new Date(),
  };
}

export async function reconcileAllWallets(db: Db = defaultPrisma): Promise<ReconciliationResult[]> {
  const wallets = await db.wallet.findMany({ select: { id: true } });
  const results: ReconciliationResult[] = [];
  for (const { id } of wallets) {
    results.push(await reconcileWallet(id, db));
  }
  return results;
}
