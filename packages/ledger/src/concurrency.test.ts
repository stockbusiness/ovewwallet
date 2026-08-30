import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@ove/database";
import { creditWallet, debitWallet } from "./credit-debit";
import { holdBalance, releaseHold } from "./hold";
import { reverseTransaction } from "./reversal";
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

  it("releases a hold exactly once when 10 concurrent releaseHold calls (different idempotency keys) target the same holdId", async () => {
    const { wallet } = await createTestWallet(1000n);
    const hold = await holdBalance({
      walletId: wallet.id,
      amount: 400,
      reason: "不正調査のため保留",
      idempotencyKey: `hold:${wallet.id}:concurrent`,
      createdBy: "admin-1",
    });

    const attempts = Array.from({ length: 10 }, (_, i) =>
      releaseHold({
        holdId: hold.id,
        idempotencyKey: `release:${hold.id}:concurrent:${i}`,
        createdBy: "admin-1",
      }).then(
        () => ({ status: "fulfilled" as const }),
        (error) => ({ status: "rejected" as const, error }),
      ),
    );

    const results = await Promise.all(attempts);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    // 異なるidempotencyKeyで同じholdへ同時に来ても、実際に解除が反映されるのは1件だけ
    // (2件目以降はロック取得後の再読込で status !== "HELD" を検知し失敗する)。
    expect(succeeded).toBe(1);

    const updated = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(updated.availableBalance).toBe(1000n); // 二重に戻されない
    expect(updated.heldBalance).toBe(0n);

    const releaseCount = await prisma.oveTransaction.count({
      where: { walletId: wallet.id, transactionType: "RELEASE", status: "COMPLETED" },
    });
    expect(releaseCount).toBe(1);
  });

  it("reverses a transaction exactly once when 10 concurrent reverseTransaction calls (different idempotency keys) target the same transactionId", async () => {
    const { wallet } = await createTestWallet(0n);
    const original = await creditWallet({
      walletId: wallet.id,
      amount: 3000,
      transactionType: "ADMIN_GRANT",
      idempotencyKey: `grant:${wallet.id}:concurrent`,
      displayName: "誤付与",
      createdByType: "ADMIN",
      createdById: "admin-1",
    });

    const attempts = Array.from({ length: 10 }, (_, i) =>
      reverseTransaction({
        transactionId: original.id,
        reason: "誤付与のため取消",
        idempotencyKey: `reverse:${original.id}:concurrent:${i}`,
        createdByType: "ADMIN",
        createdById: "admin-1",
      }).then(
        () => ({ status: "fulfilled" as const }),
        (error) => ({ status: "rejected" as const, error }),
      ),
    );

    const results = await Promise.all(attempts);
    const succeeded = results.filter((r) => r.status === "fulfilled").length;
    // 異なるidempotencyKeyで同じ取消対象へ同時に来ても、実際に取消が反映されるのは1件だけ
    // (2件目以降はロック取得後の再読込で status !== "COMPLETED" を検知して失敗するか、
    // 既存のREVERSALをそのまま返す)。
    expect(succeeded).toBe(1);

    const updated = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(updated.availableBalance).toBe(0n); // 二重に取消されない

    const reversalCount = await prisma.oveTransaction.count({
      where: { relatedTransactionId: original.id, transactionType: "REVERSAL" },
    });
    expect(reversalCount).toBe(1);
  });
});
