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

/** テスト間でウォレット関連テーブルを空にする。 */
export async function truncateLedgerTables() {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.walletHold.deleteMany(),
    prisma.oveTransaction.deleteMany(),
    prisma.wallet.deleteMany(),
    prisma.accountLink.deleteMany(),
    prisma.accountIdentity.deleteMany(),
    prisma.userSession.deleteMany(),
    prisma.oveAccount.deleteMany(),
  ]);
}
