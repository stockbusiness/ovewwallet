import { prisma, generateId, nextDisplayCode, ACCOUNT_CODE_COUNTER, WALLET_CODE_COUNTER } from "@ove/database";

export async function createTestWallet(initialBalance: bigint = 0n) {
  const accountCode = await nextDisplayCode(prisma, ACCOUNT_CODE_COUNTER, "OVE-ACC");
  const account = await prisma.oveAccount.create({
    data: {
      id: generateId(),
      accountCode,
      status: "ACTIVE",
      displayName: "Test User",
    },
  });

  const walletCode = await nextDisplayCode(prisma, WALLET_CODE_COUNTER, "OVE-WLT");
  const wallet = await prisma.wallet.create({
    data: {
      id: generateId(),
      oveAccountId: account.id,
      walletCode,
      status: "ACTIVE",
      availableBalance: initialBalance,
      lifetimeCredited: initialBalance,
    },
  });

  return { account, wallet };
}

/**
 * テスト間でウォレット関連テーブルを空にする。
 *
 * `audit_logs` はDBトリガーでDELETE/UPDATEを常に拒否する (指示書: 監査ログはDBレベルで
 * 削除不可にすること。`packages/database/prisma/migrations/*_add_audit_logs_immutability_trigger`
 * 参照) ため、ここでは削除しない。各テストは`targetId`など固有の値で自分が作成した
 * 監査ログを検索するため、他のテスト実行で残った行と衝突することはない。
 */
export async function truncateLedgerTables() {
  await prisma.$transaction([
    prisma.walletHold.deleteMany(),
    prisma.oveTransaction.deleteMany(),
    prisma.wallet.deleteMany(),
    prisma.accountLink.deleteMany(),
    prisma.accountIdentity.deleteMany(),
    prisma.userSession.deleteMany(),
    prisma.oveAccount.deleteMany(),
  ]);
}
