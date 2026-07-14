import {
  prisma as defaultPrisma,
  generateId,
  nextDisplayCode,
  TRANSACTION_CODE_COUNTER,
  type CreatedByType,
  type OveTransaction,
  type PrismaClient,
} from "@ove/database";
import { AccountAlreadyMergedError, AccountNotFoundError, InvalidMergeError, WalletNotActiveError } from "./errors";

type Db = PrismaClient;

export interface MergeAccountsParams {
  sourceAccountId: string;
  targetAccountId: string;
  reason: string;
  idempotencyKey: string;
  createdByType: CreatedByType;
  createdById?: string;
}

export interface MergeAccountsResult {
  sourceAccountId: string;
  targetAccountId: string;
  transferredAmount: string;
  debitTransaction?: OveTransaction;
  creditTransaction?: OveTransaction;
}

/**
 * アカウント統合 (指示書6章・13章)。source アカウントのウォレット残高を
 * target アカウントへ移管し、identity/link を付け替えたうえで source を
 * MERGED 状態にする。1つのDBトランザクション内で行う。
 *
 * 統合済みアカウントで再度同じ target への統合を要求した場合は冪等に成功を返す
 * (すでに別のアカウントへ統合済みの場合はエラー)。
 */
export async function mergeAccounts(
  params: MergeAccountsParams,
  db: Db = defaultPrisma,
): Promise<MergeAccountsResult> {
  if (params.sourceAccountId === params.targetAccountId) {
    throw new InvalidMergeError("source and target accounts must be different");
  }

  const source = await db.oveAccount.findUnique({ where: { id: params.sourceAccountId } });
  if (!source) throw new AccountNotFoundError(params.sourceAccountId);

  if (source.status === "MERGED") {
    if (source.mergedIntoAccountId === params.targetAccountId) {
      return { sourceAccountId: params.sourceAccountId, targetAccountId: params.targetAccountId, transferredAmount: "0" };
    }
    throw new AccountAlreadyMergedError(params.sourceAccountId, source.mergedIntoAccountId);
  }

  return db.$transaction(async (tx) => {
    const target = await tx.oveAccount.findUnique({ where: { id: params.targetAccountId } });
    if (!target) throw new AccountNotFoundError(params.targetAccountId);

    const sourceWallet = await tx.wallet.findUniqueOrThrow({ where: { oveAccountId: params.sourceAccountId } });
    const targetWallet = await tx.wallet.findUniqueOrThrow({ where: { oveAccountId: params.targetAccountId } });

    // デッドロック回避のため、常に同じ順序 (id の昇順) でロックする。
    const [firstId, secondId] = [sourceWallet.id, targetWallet.id].sort();
    await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${firstId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${secondId} FOR UPDATE`;

    const freshSource = await tx.wallet.findUniqueOrThrow({ where: { id: sourceWallet.id } });
    const freshTarget = await tx.wallet.findUniqueOrThrow({ where: { id: targetWallet.id } });

    if (freshSource.status !== "ACTIVE") throw new WalletNotActiveError(freshSource.id, freshSource.status);
    if (freshTarget.status !== "ACTIVE") throw new WalletNotActiveError(freshTarget.id, freshTarget.status);

    const amount = freshSource.availableBalance;
    let debitTransaction: OveTransaction | undefined;
    let creditTransaction: OveTransaction | undefined;

    if (amount > 0n) {
      const debitCode = await nextDisplayCode(tx, TRANSACTION_CODE_COUNTER, "OVE-TXN");
      debitTransaction = await tx.oveTransaction.create({
        data: {
          id: generateId(),
          walletId: freshSource.id,
          transactionCode: debitCode,
          transactionType: "ACCOUNT_MERGE_OUT",
          direction: "DEBIT",
          amount,
          status: "COMPLETED",
          balanceBefore: amount,
          balanceAfter: 0n,
          displayName: "アカウント統合による残高移管",
          description: params.reason,
          idempotencyKey: `${params.idempotencyKey}:OUT`,
          occurredAt: new Date(),
          completedAt: new Date(),
          createdByType: params.createdByType,
          createdById: params.createdById,
          metadata: { mergedIntoAccountId: params.targetAccountId },
        },
      });

      const creditCode = await nextDisplayCode(tx, TRANSACTION_CODE_COUNTER, "OVE-TXN");
      creditTransaction = await tx.oveTransaction.create({
        data: {
          id: generateId(),
          walletId: freshTarget.id,
          transactionCode: creditCode,
          transactionType: "ACCOUNT_MERGE_IN",
          direction: "CREDIT",
          amount,
          status: "COMPLETED",
          balanceBefore: freshTarget.availableBalance,
          balanceAfter: freshTarget.availableBalance + amount,
          displayName: "アカウント統合による残高受入",
          description: params.reason,
          idempotencyKey: `${params.idempotencyKey}:IN`,
          occurredAt: new Date(),
          completedAt: new Date(),
          createdByType: params.createdByType,
          createdById: params.createdById,
          metadata: { mergedFromAccountId: params.sourceAccountId },
        },
      });

      await tx.wallet.update({
        where: { id: freshSource.id },
        data: { availableBalance: 0n, lifetimeDebited: { increment: amount }, status: "MERGED" },
      });
      await tx.wallet.update({
        where: { id: freshTarget.id },
        data: { availableBalance: { increment: amount }, lifetimeCredited: { increment: amount } },
      });
    } else {
      await tx.wallet.update({ where: { id: freshSource.id }, data: { status: "MERGED" } });
    }

    // identity/link は (provider, providerSubject) 等がテーブル全体で一意のため、
    // オーナーの付け替え (UPDATE) は制約違反を起こさない。
    await tx.accountIdentity.updateMany({
      where: { oveAccountId: params.sourceAccountId },
      data: { oveAccountId: params.targetAccountId },
    });
    await tx.accountLink.updateMany({
      where: { oveAccountId: params.sourceAccountId },
      data: { oveAccountId: params.targetAccountId },
    });

    // 統合されたアカウントの既存セッションは無効化する。
    await tx.userSession.updateMany({
      where: { oveAccountId: params.sourceAccountId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: "ACCOUNT_MERGED" },
    });

    await tx.oveAccount.update({
      where: { id: params.sourceAccountId },
      data: { status: "MERGED", mergedIntoAccountId: params.targetAccountId, closedAt: new Date() },
    });

    await tx.auditLog.create({
      data: {
        id: generateId(),
        actorType: params.createdByType,
        actorId: params.createdById,
        actionType: "ACCOUNT_MERGE",
        targetType: "ove_account",
        targetId: params.sourceAccountId,
        result: "SUCCESS",
        reason: params.reason,
        afterData: { mergedIntoAccountId: params.targetAccountId, transferredAmount: amount.toString() },
      },
    });

    return {
      sourceAccountId: params.sourceAccountId,
      targetAccountId: params.targetAccountId,
      transferredAmount: amount.toString(),
      debitTransaction,
      creditTransaction,
    };
  });
}
