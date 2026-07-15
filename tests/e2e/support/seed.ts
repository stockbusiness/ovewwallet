import { prisma, generateId, nextDisplayCode, ACCOUNT_CODE_COUNTER, WALLET_CODE_COUNTER } from "@ove/database";
import { hashSecret } from "@ove/auth";

/**
 * Playwright E2Eテスト用のデータ投入ヘルパー。テストごとにユニークなメール/コードで
 * 作成するため、テスト同士が状態を共有せず、繰り返し実行しても衝突しない。
 */

export async function createTestAdmin(displayName = "E2E Playwright Admin"): Promise<{ email: string; password: string }> {
  const email = `pw-e2e-${generateId()}@ovewallet.local`;
  const password = "PlaywrightE2E123!";
  await prisma.adminUser.create({
    data: {
      id: generateId(),
      adminCode: `OVE-ADM-${generateId()}`,
      email,
      passwordHash: hashSecret(password),
      role: "SUPER_ADMIN",
      displayName,
    },
  });
  return { email, password };
}

export async function createTestWallet(balance = 0): Promise<{ accountId: string; accountCode: string; walletId: string; walletCode: string }> {
  const accountCode = await nextDisplayCode(prisma, ACCOUNT_CODE_COUNTER, "OVE-ACC");
  const account = await prisma.oveAccount.create({ data: { id: generateId(), accountCode, status: "ACTIVE" } });
  const walletCode = await nextDisplayCode(prisma, WALLET_CODE_COUNTER, "OVE-WLT");
  const wallet = await prisma.wallet.create({
    data: {
      id: generateId(),
      oveAccountId: account.id,
      walletCode,
      status: "ACTIVE",
      availableBalance: balance,
      lifetimeCredited: balance,
    },
  });
  return { accountId: account.id, accountCode, walletId: wallet.id, walletCode };
}

export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
