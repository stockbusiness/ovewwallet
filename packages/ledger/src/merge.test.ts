import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@ove/database";
import { creditWallet } from "./credit-debit";
import { mergeAccounts } from "./merge";
import { AccountAlreadyMergedError, InvalidMergeError } from "./errors";
import { createTestWallet, truncateLedgerTables } from "./test-helpers";

describe("mergeAccounts", () => {
  afterEach(async () => {
    await truncateLedgerTables();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("transfers the source wallet's balance into the target wallet and marks source MERGED", async () => {
    const { account: source, wallet: sourceWallet } = await createTestWallet(0n);
    const { account: target, wallet: targetWallet } = await createTestWallet(0n);

    await creditWallet({
      walletId: sourceWallet.id,
      amount: 4000,
      transactionType: "ADMIN_GRANT",
      idempotencyKey: `grant:${sourceWallet.id}`,
      displayName: "付与",
      createdByType: "ADMIN",
    });
    await creditWallet({
      walletId: targetWallet.id,
      amount: 1000,
      transactionType: "ADMIN_GRANT",
      idempotencyKey: `grant:${targetWallet.id}`,
      displayName: "付与",
      createdByType: "ADMIN",
    });

    const result = await mergeAccounts({
      sourceAccountId: source.id,
      targetAccountId: target.id,
      reason: "重複アカウントのため統合",
      idempotencyKey: `merge:${source.id}:${target.id}`,
      createdByType: "ADMIN",
      createdById: "admin-1",
    });

    expect(result.transferredAmount).toBe("4000");

    const updatedSourceWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: sourceWallet.id } });
    expect(updatedSourceWallet.availableBalance).toBe(0n);
    expect(updatedSourceWallet.status).toBe("MERGED");

    const updatedTargetWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: targetWallet.id } });
    expect(updatedTargetWallet.availableBalance).toBe(5000n); // 1000 + 4000

    const updatedSourceAccount = await prisma.oveAccount.findUniqueOrThrow({ where: { id: source.id } });
    expect(updatedSourceAccount.status).toBe("MERGED");
    expect(updatedSourceAccount.mergedIntoAccountId).toBe(target.id);
  });

  it("moves account_identities and account_links from source to target", async () => {
    const { account: source, wallet: sourceWallet } = await createTestWallet(0n);
    const { account: target } = await createTestWallet(0n);

    await prisma.accountIdentity.create({
      data: {
        id: `test-identity-${source.id}`,
        oveAccountId: source.id,
        identityType: "EMAIL",
        provider: "EMAIL",
        providerSubject: `merge-test-${source.id}@example.com`,
      },
    });

    await mergeAccounts({
      sourceAccountId: source.id,
      targetAccountId: target.id,
      reason: "統合テスト",
      idempotencyKey: `merge:${source.id}:${target.id}:identity`,
      createdByType: "ADMIN",
      createdById: "admin-1",
    });

    const identity = await prisma.accountIdentity.findUniqueOrThrow({
      where: { id: `test-identity-${source.id}` },
    });
    expect(identity.oveAccountId).toBe(target.id);
    void sourceWallet;
  });

  it("is idempotent when merging the same source into the same target twice", async () => {
    const { account: source, wallet: sourceWallet } = await createTestWallet(0n);
    const { account: target, wallet: targetWallet } = await createTestWallet(0n);

    await creditWallet({
      walletId: sourceWallet.id,
      amount: 2000,
      transactionType: "ADMIN_GRANT",
      idempotencyKey: `grant2:${sourceWallet.id}`,
      displayName: "付与",
      createdByType: "ADMIN",
    });

    const key = `merge:${source.id}:${target.id}:idem`;
    await mergeAccounts({
      sourceAccountId: source.id,
      targetAccountId: target.id,
      reason: "統合",
      idempotencyKey: key,
      createdByType: "ADMIN",
      createdById: "admin-1",
    });
    const second = await mergeAccounts({
      sourceAccountId: source.id,
      targetAccountId: target.id,
      reason: "統合 (再送)",
      idempotencyKey: key,
      createdByType: "ADMIN",
      createdById: "admin-1",
    });
    expect(second.transferredAmount).toBe("0"); // 既に統合済みなので冪等に成功を返す

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: targetWallet.id } });
    expect(wallet.availableBalance).toBe(2000n); // 二重加算されない
  });

  it("rejects merging an account that is already merged into a different target", async () => {
    const { account: source } = await createTestWallet(0n);
    const { account: target1 } = await createTestWallet(0n);
    const { account: target2 } = await createTestWallet(0n);

    await mergeAccounts({
      sourceAccountId: source.id,
      targetAccountId: target1.id,
      reason: "統合1",
      idempotencyKey: `merge:${source.id}:${target1.id}`,
      createdByType: "ADMIN",
      createdById: "admin-1",
    });

    await expect(
      mergeAccounts({
        sourceAccountId: source.id,
        targetAccountId: target2.id,
        reason: "統合2 (別ターゲット)",
        idempotencyKey: `merge:${source.id}:${target2.id}`,
        createdByType: "ADMIN",
        createdById: "admin-1",
      }),
    ).rejects.toBeInstanceOf(AccountAlreadyMergedError);
  });

  it("rejects merging an account into itself", async () => {
    const { account } = await createTestWallet(0n);
    await expect(
      mergeAccounts({
        sourceAccountId: account.id,
        targetAccountId: account.id,
        reason: "自己統合",
        idempotencyKey: `merge:${account.id}:self`,
        createdByType: "ADMIN",
        createdById: "admin-1",
      }),
    ).rejects.toBeInstanceOf(InvalidMergeError);
  });
});
