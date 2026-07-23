import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@ove/database";
import { creditWallet, creditWalletInTransaction, debitWallet } from "./credit-debit";
import { InsufficientBalanceError, WalletNotActiveError } from "./errors";
import { createTestWallet, truncateLedgerTables } from "./test-helpers";

describe("creditWallet / debitWallet", () => {
  afterEach(async () => {
    await truncateLedgerTables();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("credits a wallet and increases available_balance", async () => {
    const { wallet } = await createTestWallet(0n);

    const txn = await creditWallet({
      walletId: wallet.id,
      amount: 3000,
      transactionType: "REGISTRATION_BONUS",
      idempotencyKey: `REGISTRATION_BONUS:${wallet.id}`,
      displayName: "戦国パスポート登録特典",
      createdByType: "SYSTEM",
    });

    expect(txn.status).toBe("COMPLETED");
    expect(txn.balanceBefore).toBe(0n);
    expect(txn.balanceAfter).toBe(3000n);

    const updated = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(updated.availableBalance).toBe(3000n);
    expect(updated.lifetimeCredited).toBe(3000n);
  });

  it("is idempotent: calling credit twice with the same key only records one transaction", async () => {
    const { wallet } = await createTestWallet(0n);
    const key = `AIART_ATTENDANCE:EVENT-1:${wallet.id}`;

    const first = await creditWallet({
      walletId: wallet.id,
      amount: 10000,
      transactionType: "AIART_ATTENDANCE",
      idempotencyKey: key,
      displayName: "AIアート教室参加特典",
      createdByType: "EXTERNAL_SERVICE",
    });
    const second = await creditWallet({
      walletId: wallet.id,
      amount: 10000,
      transactionType: "AIART_ATTENDANCE",
      idempotencyKey: key,
      displayName: "AIアート教室参加特典",
      createdByType: "EXTERNAL_SERVICE",
    });

    expect(second.id).toBe(first.id);
    const count = await prisma.oveTransaction.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);

    const updated = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(updated.availableBalance).toBe(10000n); // 二重加算されない
  });

  it("debits a wallet and decreases available_balance", async () => {
    const { wallet } = await createTestWallet(5000n);

    const txn = await debitWallet({
      walletId: wallet.id,
      amount: 2000,
      transactionType: "ITEM_EXCHANGE",
      idempotencyKey: `debit:${wallet.id}:1`,
      displayName: "アイテム交換",
      createdByType: "EXTERNAL_SERVICE",
    });

    expect(txn.balanceBefore).toBe(5000n);
    expect(txn.balanceAfter).toBe(3000n);

    const updated = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(updated.availableBalance).toBe(3000n);
    expect(updated.lifetimeDebited).toBe(2000n);
  });

  it("rejects a debit that would exceed the available balance and leaves the balance unchanged", async () => {
    const { wallet } = await createTestWallet(1000n);

    await expect(
      debitWallet({
        walletId: wallet.id,
        amount: 5000,
        transactionType: "ITEM_EXCHANGE",
        idempotencyKey: `debit:${wallet.id}:overspend`,
        displayName: "アイテム交換",
        createdByType: "EXTERNAL_SERVICE",
      }),
    ).rejects.toBeInstanceOf(InsufficientBalanceError);

    const updated = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(updated.availableBalance).toBe(1000n); // 残高は変化しない

    const txnCount = await prisma.oveTransaction.count({ where: { walletId: wallet.id } });
    expect(txnCount).toBe(0); // 取引レコードも作成されない

    const rejectionLog = await prisma.auditLog.findFirst({
      where: { targetId: wallet.id, actionType: "LEDGER_DEBIT_REJECTED" },
    });
    expect(rejectionLog).not.toBeNull();
    expect(rejectionLog?.result).toBe("FAILURE");
  });

  it("creditWalletInTransaction credits within an already-open transaction (Phase 3 原子性)", async () => {
    const { wallet } = await createTestWallet(0n);
    const key = `PHASE3_ATOMIC:${wallet.id}`;

    const txn = await prisma.$transaction((tx) =>
      creditWalletInTransaction(tx, {
        walletId: wallet.id,
        amount: 500,
        transactionType: "REFERRAL_REWARD",
        idempotencyKey: key,
        displayName: "代理店紹介登録特典",
        createdByType: "EXTERNAL_SERVICE",
      }),
    );

    expect(txn.status).toBe("COMPLETED");
    const updated = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(updated.availableBalance).toBe(500n);
  });

  it("creditWalletInTransaction rolls back together with a later failure in the same transaction", async () => {
    const { wallet } = await createTestWallet(0n);
    const key = `PHASE3_ROLLBACK:${wallet.id}`;

    await expect(
      prisma.$transaction(async (tx) => {
        await creditWalletInTransaction(tx, {
          walletId: wallet.id,
          amount: 700,
          transactionType: "REFERRAL_REWARD",
          idempotencyKey: key,
          displayName: "代理店紹介登録特典",
          createdByType: "EXTERNAL_SERVICE",
        });
        throw new Error("simulated failure after credit, in the same transaction");
      }),
    ).rejects.toThrow("simulated failure after credit");

    // 同一トランザクション内での後続失敗により、CREDIT自体もロールバックされる。
    const updated = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(updated.availableBalance).toBe(0n);
    const txnCount = await prisma.oveTransaction.count({ where: { idempotencyKey: key } });
    expect(txnCount).toBe(0);
  });

  it("rejects operations on a non-ACTIVE wallet", async () => {
    const { wallet } = await createTestWallet(1000n);
    await prisma.wallet.update({ where: { id: wallet.id }, data: { status: "LOCKED" } });

    await expect(
      creditWallet({
        walletId: wallet.id,
        amount: 100,
        transactionType: "ADMIN_GRANT",
        idempotencyKey: `credit:${wallet.id}:locked`,
        displayName: "管理者付与",
        createdByType: "ADMIN",
      }),
    ).rejects.toBeInstanceOf(WalletNotActiveError);
  });
});
