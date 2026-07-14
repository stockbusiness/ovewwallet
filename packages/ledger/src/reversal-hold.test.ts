import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@ove/database";
import { creditWallet, debitWallet } from "./credit-debit";
import { reverseTransaction } from "./reversal";
import { holdBalance, releaseHold } from "./hold";
import { createTestWallet, truncateLedgerTables } from "./test-helpers";

describe("reverseTransaction", () => {
  afterEach(async () => {
    await truncateLedgerTables();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("reverses a CREDIT transaction, restores balance, and marks the original REVERSED", async () => {
    const { wallet } = await createTestWallet(0n);
    const original = await creditWallet({
      walletId: wallet.id,
      amount: 3000,
      transactionType: "ADMIN_GRANT",
      idempotencyKey: `grant:${wallet.id}:1`,
      displayName: "誤付与",
      createdByType: "ADMIN",
      createdById: "admin-1",
    });

    const reversal = await reverseTransaction({
      transactionId: original.id,
      reason: "誤付与のため取消",
      idempotencyKey: `reverse:${original.id}`,
      createdByType: "ADMIN",
      createdById: "admin-1",
    });

    expect(reversal.transactionType).toBe("REVERSAL");
    expect(reversal.direction).toBe("DEBIT");
    expect(reversal.relatedTransactionId).toBe(original.id);
    expect(reversal.amount).toBe(3000n);

    const updatedOriginal = await prisma.oveTransaction.findUniqueOrThrow({ where: { id: original.id } });
    expect(updatedOriginal.status).toBe("REVERSED");
    // 金額・種別・理由は不変
    expect(updatedOriginal.amount).toBe(3000n);
    expect(updatedOriginal.transactionType).toBe("ADMIN_GRANT");

    const updatedWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(updatedWallet.availableBalance).toBe(0n);
  });

  it("does not delete the original transaction", async () => {
    const { wallet } = await createTestWallet(0n);
    const original = await creditWallet({
      walletId: wallet.id,
      amount: 500,
      transactionType: "ADMIN_GRANT",
      idempotencyKey: `grant:${wallet.id}:2`,
      displayName: "付与",
      createdByType: "ADMIN",
      createdById: "admin-1",
    });

    await reverseTransaction({
      transactionId: original.id,
      reason: "取消",
      idempotencyKey: `reverse:${original.id}`,
      createdByType: "ADMIN",
      createdById: "admin-1",
    });

    const stillExists = await prisma.oveTransaction.findUnique({ where: { id: original.id } });
    expect(stillExists).not.toBeNull();
  });

  it("is idempotent on repeated reversal calls with the same key", async () => {
    const { wallet } = await createTestWallet(0n);
    const original = await creditWallet({
      walletId: wallet.id,
      amount: 1000,
      transactionType: "ADMIN_GRANT",
      idempotencyKey: `grant:${wallet.id}:3`,
      displayName: "付与",
      createdByType: "ADMIN",
      createdById: "admin-1",
    });

    const key = `reverse:${original.id}`;
    const first = await reverseTransaction({
      transactionId: original.id,
      reason: "取消",
      idempotencyKey: key,
      createdByType: "ADMIN",
      createdById: "admin-1",
    });
    const second = await reverseTransaction({
      transactionId: original.id,
      reason: "取消 (再送)",
      idempotencyKey: key,
      createdByType: "ADMIN",
      createdById: "admin-1",
    });

    expect(second.id).toBe(first.id);
    const wallet2 = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(wallet2.availableBalance).toBe(0n); // 二重取消されない
  });

  it("reverses a DEBIT transaction by crediting the amount back", async () => {
    const { wallet } = await createTestWallet(5000n);
    const original = await debitWallet({
      walletId: wallet.id,
      amount: 2000,
      transactionType: "ITEM_EXCHANGE",
      idempotencyKey: `debit:${wallet.id}:rev`,
      displayName: "アイテム交換",
      createdByType: "EXTERNAL_SERVICE",
    });

    await reverseTransaction({
      transactionId: original.id,
      reason: "交換キャンセル",
      idempotencyKey: `reverse:${original.id}`,
      createdByType: "ADMIN",
      createdById: "admin-1",
    });

    const updatedWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(updatedWallet.availableBalance).toBe(5000n);
  });
});

describe("holdBalance / releaseHold", () => {
  afterEach(async () => {
    await truncateLedgerTables();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("moves funds from available to held, then releases them back", async () => {
    const { wallet } = await createTestWallet(1000n);

    const hold = await holdBalance({
      walletId: wallet.id,
      amount: 400,
      reason: "不正調査のため保留",
      idempotencyKey: `hold:${wallet.id}:1`,
      createdBy: "admin-1",
    });

    let updated = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(updated.availableBalance).toBe(600n);
    expect(updated.heldBalance).toBe(400n);

    await releaseHold({
      holdId: hold.id,
      idempotencyKey: `release:${hold.id}`,
      createdBy: "admin-1",
    });

    updated = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(updated.availableBalance).toBe(1000n);
    expect(updated.heldBalance).toBe(0n);

    const holdRow = await prisma.walletHold.findUniqueOrThrow({ where: { id: hold.id } });
    expect(holdRow.status).toBe("RELEASED");
  });
});
