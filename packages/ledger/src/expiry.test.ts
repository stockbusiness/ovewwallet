import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma, generateId } from "@ove/database";
import { creditWallet, debitWallet } from "./credit-debit";
import { reverseTransaction } from "./reversal";
import { expireDueCreditLots } from "./expiry";
import { createTestWallet, truncateLedgerTables } from "./test-helpers";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("OVE有効期限 (ove_credit_lots)", () => {
  afterEach(async () => {
    await truncateLedgerTables();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("expiresAtを指定してcreditすると失効ロットが作成される", async () => {
    const { wallet } = await createTestWallet(0n);
    const expiresAt = new Date(Date.now() + 30 * DAY_MS);

    const txn = await creditWallet({
      walletId: wallet.id,
      amount: 1000,
      transactionType: "AIART_ATTENDANCE",
      idempotencyKey: generateId(),
      displayName: "AIアート教室参加特典",
      createdByType: "EXTERNAL_SERVICE",
      expiresAt,
    });

    const lot = await prisma.oveCreditLot.findUnique({ where: { transactionId: txn.id } });
    expect(lot).not.toBeNull();
    expect(lot?.amount).toBe(1000n);
    expect(lot?.remainingAmount).toBe(1000n);
  });

  it("expiresAt未指定ならロットは作成されない (既存呼び出しへの非破壊性)", async () => {
    const { wallet } = await createTestWallet(0n);
    const txn = await creditWallet({
      walletId: wallet.id,
      amount: 1000,
      transactionType: "ADMIN_GRANT",
      idempotencyKey: generateId(),
      displayName: "管理者付与",
      createdByType: "ADMIN",
    });

    const lot = await prisma.oveCreditLot.findUnique({ where: { transactionId: txn.id } });
    expect(lot).toBeNull();
  });

  it("debitは有効期限が近いロットから優先的に消費する(FIFO)", async () => {
    const { wallet } = await createTestWallet(0n);

    await creditWallet({
      walletId: wallet.id,
      amount: 500,
      transactionType: "AIART_ATTENDANCE",
      idempotencyKey: generateId(),
      displayName: "期限が遠いロット",
      createdByType: "EXTERNAL_SERVICE",
      expiresAt: new Date(Date.now() + 60 * DAY_MS),
    });
    const soonTxn = await creditWallet({
      walletId: wallet.id,
      amount: 300,
      transactionType: "AIART_ATTENDANCE",
      idempotencyKey: generateId(),
      displayName: "期限が近いロット",
      createdByType: "EXTERNAL_SERVICE",
      expiresAt: new Date(Date.now() + 10 * DAY_MS),
    });

    await debitWallet({
      walletId: wallet.id,
      amount: 200,
      transactionType: "ITEM_EXCHANGE",
      idempotencyKey: generateId(),
      displayName: "アイテム交換",
      createdByType: "USER",
    });

    const soonLot = await prisma.oveCreditLot.findUnique({ where: { transactionId: soonTxn.id } });
    expect(soonLot?.remainingAmount).toBe(100n); // 300 - 200 が先に消費される

    const wallet2 = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(wallet2.availableBalance).toBe(600n); // 500 + 300 - 200
  });

  it("CREDITの取消(REVERSAL)はロットを無効化する", async () => {
    const { wallet } = await createTestWallet(0n);
    const txn = await creditWallet({
      walletId: wallet.id,
      amount: 1000,
      transactionType: "AIART_ATTENDANCE",
      idempotencyKey: generateId(),
      displayName: "AIアート教室参加特典",
      createdByType: "EXTERNAL_SERVICE",
      expiresAt: new Date(Date.now() + 30 * DAY_MS),
    });

    await reverseTransaction({
      transactionId: txn.id,
      reason: "誤付与のため取消",
      idempotencyKey: generateId(),
      createdByType: "ADMIN",
    });

    const lot = await prisma.oveCreditLot.findUnique({ where: { transactionId: txn.id } });
    expect(lot?.voidedAt).not.toBeNull();
    expect(lot?.remainingAmount).toBe(0n);
  });

  it("期限切れロットはexpireDueCreditLotsでEXPIRATION取引として失効する", async () => {
    const { wallet } = await createTestWallet(0n);
    await creditWallet({
      walletId: wallet.id,
      amount: 700,
      transactionType: "AIART_ATTENDANCE",
      idempotencyKey: generateId(),
      displayName: "期限切れ済みロット",
      createdByType: "EXTERNAL_SERVICE",
      expiresAt: new Date(Date.now() - DAY_MS), // 既に期限切れ
    });

    const result = await expireDueCreditLots(prisma);
    expect(result.walletsProcessed).toBe(1);
    expect(result.totalExpiredAmount).toBe(700n);

    const updated = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(updated.availableBalance).toBe(0n);

    const expirationTxn = await prisma.oveTransaction.findFirst({
      where: { walletId: wallet.id, transactionType: "EXPIRATION" },
    });
    expect(expirationTxn?.amount).toBe(700n);
    expect(expirationTxn?.direction).toBe("DEBIT");

    // 再実行しても二重に失効しない (対象ロットが残っていないため)
    const second = await expireDueCreditLots(prisma);
    expect(second.walletsProcessed).toBe(0);
  });

  it("失効ロットが既に一部使われていれば残額のみ失効する", async () => {
    const { wallet } = await createTestWallet(0n);
    await creditWallet({
      walletId: wallet.id,
      amount: 1000,
      transactionType: "AIART_ATTENDANCE",
      idempotencyKey: generateId(),
      displayName: "一部消費されるロット",
      createdByType: "EXTERNAL_SERVICE",
      expiresAt: new Date(Date.now() - DAY_MS),
    });
    await debitWallet({
      walletId: wallet.id,
      amount: 400,
      transactionType: "ITEM_EXCHANGE",
      idempotencyKey: generateId(),
      displayName: "アイテム交換",
      createdByType: "USER",
    });

    const result = await expireDueCreditLots(prisma);
    expect(result.totalExpiredAmount).toBe(600n); // 1000 - 400 の残りのみ失効

    const updated = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(updated.availableBalance).toBe(0n); // 600 - 600
  });
});
