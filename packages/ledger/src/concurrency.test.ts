import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@ove/database";
import { creditWallet, debitWallet } from "./credit-debit";
import { createTestWallet, truncateLedgerTables } from "./test-helpers";

describe("concurrency (指示書18章: 特に必須のテスト)", () => {
  afterEach(async () => {
    await truncateLedgerTables();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates exactly one transaction when the same idempotency key is used by 10 concurrent requests", async () => {
    const { wallet } = await createTestWallet(0n);
    const key = `AIART_ATTENDANCE:EVENT-CONCURRENT:${wallet.id}`;

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        creditWallet({
          walletId: wallet.id,
          amount: 10000,
          transactionType: "AIART_ATTENDANCE",
          idempotencyKey: key,
          displayName: "AIアート教室参加特典",
          createdByType: "EXTERNAL_SERVICE",
        }),
      ),
    );

    const distinctIds = new Set(results.map((r) => r.id));
    expect(distinctIds.size).toBe(1);

    const count = await prisma.oveTransaction.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);

    const updated = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(updated.availableBalance).toBe(10000n); // 一度だけ加算される
  });

  it("never allows the balance to go negative under 10 concurrent overlapping DEBITs", async () => {
    const { wallet } = await createTestWallet(5000n);

    const attempts = Array.from({ length: 10 }, (_, i) =>
      debitWallet({
        walletId: wallet.id,
        amount: 1000,
        transactionType: "ITEM_EXCHANGE",
        idempotencyKey: `debit:${wallet.id}:concurrent:${i}`,
        displayName: "アイテム交換",
        createdByType: "EXTERNAL_SERVICE",
      }).then(
        () => ({ status: "fulfilled" as const }),
        (error) => ({ status: "rejected" as const, error }),
      ),
    );

    const results = await Promise.all(attempts);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.filter((r) => r.status === "rejected").length;

    // 5000 / 1000 = 5件だけ成功するはず (行ロックにより残高不足分は拒否される)
    expect(succeeded).toBe(5);
    expect(failed).toBe(5);

    const updated = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(updated.availableBalance).toBe(0n);
    expect(updated.availableBalance >= 0n).toBe(true);

    const completedDebits = await prisma.oveTransaction.count({
      where: { walletId: wallet.id, status: "COMPLETED", direction: "DEBIT" },
    });
    expect(completedDebits).toBe(5);
  });
});
