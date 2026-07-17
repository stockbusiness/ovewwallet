import "reflect-metadata";
import {
  prisma,
  generateId,
  nextDisplayCode,
  ACCOUNT_CODE_COUNTER,
  WALLET_CODE_COUNTER,
  TRANSACTION_CODE_COUNTER,
} from "@ove/database";

/**
 * ove_transactions (台帳の中核テーブル) はアプリケーション層の禁止だけでなく、DBレベル
 * (トリガー) でもDELETEと、COMPLETED取引の主要項目のUPDATEを拒否する
 * (マイグレーション `add_ove_transactions_immutability_trigger`、実装指示書
 * 「OVEウォレット 今後の実装・運用指示書 v1.0」5.1章)。`audit_logs`と同じ理由で、
 * アプリがpostgresの特権ユーザーで接続していてもGRANT/REVOKEでは無意味なため、
 * BEFOREトリガーで例外を送出する方式を採用している。
 */
describe("ove_transactions immutability (DBレベル)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createCompletedTransaction() {
    const accountCode = await nextDisplayCode(prisma, ACCOUNT_CODE_COUNTER, "OVE-ACC");
    const account = await prisma.oveAccount.create({ data: { id: generateId(), accountCode, status: "ACTIVE" } });
    const walletCode = await nextDisplayCode(prisma, WALLET_CODE_COUNTER, "OVE-WLT");
    const wallet = await prisma.wallet.create({
      data: { id: generateId(), oveAccountId: account.id, walletCode, status: "ACTIVE" },
    });
    const transactionCode = await nextDisplayCode(prisma, TRANSACTION_CODE_COUNTER, "OVE-TXN");
    const id = generateId();
    await prisma.oveTransaction.create({
      data: {
        id,
        walletId: wallet.id,
        transactionCode,
        transactionType: "ADMIN_GRANT",
        direction: "CREDIT",
        amount: 1000,
        status: "COMPLETED",
        balanceBefore: 0,
        balanceAfter: 1000,
        displayName: "DBレベル不変性テスト",
        idempotencyKey: `TEST_IMMUTABILITY:${id}`,
        createdByType: "ADMIN",
      },
    });
    return { id, walletId: wallet.id };
  }

  it("rejects DELETE at the DB level even for the app's own connection", async () => {
    const { id } = await createCompletedTransaction();

    await expect(prisma.$executeRawUnsafe(`DELETE FROM "ove_transactions" WHERE id = $1`, id)).rejects.toThrow(
      /append-only/,
    );

    const row = await prisma.oveTransaction.findUnique({ where: { id } });
    expect(row).not.toBeNull(); // 削除されず残っている
  });

  it("rejects changing amount/direction/wallet_id/transaction_type/idempotency_key on a COMPLETED transaction", async () => {
    const { id, walletId } = await createCompletedTransaction();

    await expect(
      prisma.$executeRawUnsafe(`UPDATE "ove_transactions" SET amount = 999999 WHERE id = $1`, id),
    ).rejects.toThrow(/cannot change/);

    const otherWalletCode = await nextDisplayCode(prisma, WALLET_CODE_COUNTER, "OVE-WLT");
    const otherAccountCode = await nextDisplayCode(prisma, ACCOUNT_CODE_COUNTER, "OVE-ACC");
    const otherAccount = await prisma.oveAccount.create({
      data: { id: generateId(), accountCode: otherAccountCode, status: "ACTIVE" },
    });
    const otherWallet = await prisma.wallet.create({
      data: { id: generateId(), oveAccountId: otherAccount.id, walletCode: otherWalletCode, status: "ACTIVE" },
    });
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "ove_transactions" SET wallet_id = $1 WHERE id = $2`, otherWallet.id, id),
    ).rejects.toThrow(/cannot change/);

    const row = await prisma.oveTransaction.findUniqueOrThrow({ where: { id } });
    expect(row.amount.toString()).toBe("1000"); // 変更されていない
    expect(row.walletId).toBe(walletId);
  });

  it("still allows the one legitimate status transition (COMPLETED -> REVERSED)", async () => {
    const { id } = await createCompletedTransaction();

    await prisma.oveTransaction.update({ where: { id }, data: { status: "REVERSED" } });

    const row = await prisma.oveTransaction.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("REVERSED");
  });

  it("still allows normal INSERT/SELECT (the only other operations the app performs)", async () => {
    const { id } = await createCompletedTransaction();
    const row = await prisma.oveTransaction.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("COMPLETED");
  });
});
