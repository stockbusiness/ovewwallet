import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@ove/database";
import { creditWallet, debitWallet } from "./credit-debit";
import { holdBalance, releaseHold } from "./hold";
import { reverseTransaction } from "./reversal";
import { reconcileWallet } from "./reconcile";
import { createTestWallet, truncateLedgerTables } from "./test-helpers";

describe("reconcileWallet", () => {
  afterEach(async () => {
    await truncateLedgerTables();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("reports consistent when cached balance matches CREDIT - DEBIT - held", async () => {
    const { wallet } = await createTestWallet(0n);
    await creditWallet({
      walletId: wallet.id,
      amount: 3000,
      transactionType: "REGISTRATION_BONUS",
      idempotencyKey: `c:${wallet.id}:1`,
      displayName: "登録特典",
      createdByType: "SYSTEM",
    });
    await debitWallet({
      walletId: wallet.id,
      amount: 500,
      transactionType: "ITEM_EXCHANGE",
      idempotencyKey: `d:${wallet.id}:1`,
      displayName: "利用",
      createdByType: "EXTERNAL_SERVICE",
    });
    await holdBalance({
      walletId: wallet.id,
      amount: 200,
      reason: "調査",
      idempotencyKey: `h:${wallet.id}:1`,
      createdBy: "admin-1",
    });

    const result = await reconcileWallet(wallet.id);
    expect(result.computedBalance).toBe(2300n); // 3000 - 500 - 200
    expect(result.cachedBalance).toBe(2300n);
    expect(result.isConsistent).toBe(true);
  });

  it("detects a mismatch without auto-correcting the wallet", async () => {
    const { wallet } = await createTestWallet(0n);
    await creditWallet({
      walletId: wallet.id,
      amount: 1000,
      transactionType: "ADMIN_GRANT",
      idempotencyKey: `c:${wallet.id}:2`,
      displayName: "付与",
      createdByType: "ADMIN",
    });

    // 台帳を経由しない不正な直接更新をシミュレートし、不一致を発生させる
    await prisma.wallet.update({ where: { id: wallet.id }, data: { availableBalance: 9999n } });

    const result = await reconcileWallet(wallet.id);
    expect(result.isConsistent).toBe(false);
    expect(result.difference).toBe(9999n - 1000n);

    const stillMismatched = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(stillMismatched.availableBalance).toBe(9999n); // 自動修正されない
  });

  it("stays consistent after a DEBIT is reversed (REVERSED transactions must still count)", async () => {
    const { wallet } = await createTestWallet(0n);
    await creditWallet({
      walletId: wallet.id,
      amount: 10000,
      transactionType: "AIART_ATTENDANCE",
      idempotencyKey: `c:${wallet.id}:3`,
      displayName: "AIアート教室参加特典",
      createdByType: "EXTERNAL_SERVICE",
    });
    const debit = await debitWallet({
      walletId: wallet.id,
      amount: 3000,
      transactionType: "ITEM_EXCHANGE",
      idempotencyKey: `d:${wallet.id}:2`,
      displayName: "アイテム交換",
      createdByType: "EXTERNAL_SERVICE",
    });
    await reverseTransaction({
      transactionId: debit.id,
      reason: "テスト取消",
      idempotencyKey: `r:${debit.id}`,
      createdByType: "ADMIN",
      createdById: "admin-1",
    });

    const result = await reconcileWallet(wallet.id);
    expect(result.cachedBalance).toBe(10000n);
    expect(result.computedBalance).toBe(10000n); // 10000 - 3000(REVERSED) + 3000(REVERSAL) = 10000
    expect(result.isConsistent).toBe(true);
  });

  it("stays consistent after a HOLD is released (HOLD/RELEASE must not leak into CREDIT/DEBIT sums)", async () => {
    const { wallet } = await createTestWallet(0n);
    await creditWallet({
      walletId: wallet.id,
      amount: 10000,
      transactionType: "ADMIN_GRANT",
      idempotencyKey: `c:${wallet.id}:4`,
      displayName: "付与",
      createdByType: "ADMIN",
    });
    const hold = await holdBalance({
      walletId: wallet.id,
      amount: 2000,
      reason: "調査",
      idempotencyKey: `h:${wallet.id}:2`,
      createdBy: "admin-1",
    });
    await releaseHold({
      holdId: hold.id,
      idempotencyKey: `rel:${hold.id}`,
      createdBy: "admin-1",
    });

    const result = await reconcileWallet(wallet.id);
    expect(result.cachedBalance).toBe(10000n);
    expect(result.computedBalance).toBe(10000n);
    expect(result.isConsistent).toBe(true);
  });
});
