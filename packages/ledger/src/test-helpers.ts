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
 * `audit_logs`・`ove_transactions` はDBトリガーでDELETE (と`ove_transactions`は
 * COMPLETED取引の主要項目のUPDATE) を常に拒否する (実装指示書「OVEウォレット
 * 今後の実装・運用指示書 v1.0」5.1章。`packages/database/prisma/migrations/
 * *_add_audit_logs_immutability_trigger`・`*_add_ove_transactions_immutability_trigger`
 * 参照) ため、どちらもここでは削除しない。各テストは`walletId`など固有の値
 * (`createTestWallet()`が毎回新規生成するアカウント/ウォレットID) で自分が作成した
 * 取引を検索するため、他のテスト実行で残った行と衝突することはない。
 *
 * `wallet`/`oveAccount`は`oveTransaction.walletId`から外部キー参照されているため、
 * `oveTransaction`を削除しない以上、こちらも削除できない (削除すると外部キー制約違反に
 * なる)。同じ理由で`accountLink`/`accountIdentity`/`userSession`も対象外とする。
 * `walletHold`のみ`oveTransaction`から参照されないため引き続き削除する。
 */
export async function truncateLedgerTables() {
  await prisma.walletHold.deleteMany();
}
