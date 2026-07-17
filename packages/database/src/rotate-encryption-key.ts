import { decryptSecret, encryptSecret } from "@ove/auth";
import { prisma } from "./client";

/**
 * ENCRYPTION_KEYのローテーション用一括再暗号化スクリプト (docs/deployment.md
 * 「ENCRYPTION_KEYのローテーション」章で「このリポジトリにはまだ実装していない」と
 * されていたメンテナンススクリプト)。
 *
 * 対象は ENCRYPTION_KEY (AES-256-GCM) で暗号化している3カラム:
 *   - admin_users.mfaSecretEncrypted (管理者MFAのTOTPシークレット, nullable)
 *   - service_integrations.signingSecretEncrypted (外部サービスHMAC署名シークレット)
 *   - wallet_referrals.referralTokenEncrypted (代理店紹介トークン、Phase2の外部送信用)
 *
 * 実行前提: アプリはまだ旧鍵 (OLD_ENCRYPTION_KEY) で動作中であること。このスクリプトは
 * 旧鍵で全件復号→新鍵で再暗号化するだけで、環境変数ENCRYPTION_KEYの切り替えは行わない
 * (docs/deployment.md手順1-5の手順2に相当。手順3で改めてアプリ側のENCRYPTION_KEYを
 * 新鍵へ切り替えること)。
 *
 * 使い方:
 *   OLD_ENCRYPTION_KEY=... NEW_ENCRYPTION_KEY=... pnpm --filter @ove/database rotate-encryption-key
 *
 * 複合失敗 (旧鍵の指定間違い等) を検知した場合は該当行のIDを記録し、1件もDBを更新せず
 * 中断する (中途半端に一部だけ新鍵へ移行した状態を避けるため)。
 */
async function main() {
  const oldKey = process.env.OLD_ENCRYPTION_KEY;
  const newKey = process.env.NEW_ENCRYPTION_KEY;
  if (!oldKey || !newKey) {
    console.error("エラー: OLD_ENCRYPTION_KEY と NEW_ENCRYPTION_KEY の両方を指定してください");
    process.exitCode = 1;
    return;
  }
  if (oldKey === newKey) {
    console.error("エラー: OLD_ENCRYPTION_KEY と NEW_ENCRYPTION_KEY が同じ値です");
    process.exitCode = 1;
    return;
  }

  const adminUsers = await prisma.adminUser.findMany({
    where: { mfaSecretEncrypted: { not: null } },
    select: { id: true, mfaSecretEncrypted: true },
  });
  const serviceIntegrations = await prisma.serviceIntegration.findMany({
    select: { id: true, signingSecretEncrypted: true },
  });
  const walletReferrals = await prisma.walletReferral.findMany({
    select: { id: true, referralTokenEncrypted: true },
  });

  console.log(
    `対象: admin_users ${adminUsers.length}件 / service_integrations ${serviceIntegrations.length}件 / ` +
      `wallet_referrals ${walletReferrals.length}件`,
  );

  // 先に全件を旧鍵で復号→新鍵で再暗号化してメモリ上に用意する。
  // 1件でも復号に失敗したら、DBへは一切書き込まずに中断する
  // (途中まで新鍵、途中から旧鍵という不整合な状態を防ぐ)。
  type Update = { table: "adminUser" | "serviceIntegration" | "walletReferral"; id: string; reencrypted: string };
  const updates: Update[] = [];
  const errors: string[] = [];

  for (const row of adminUsers) {
    try {
      const plain = decryptSecret(row.mfaSecretEncrypted!, oldKey);
      updates.push({ table: "adminUser", id: row.id, reencrypted: encryptSecret(plain, newKey) });
    } catch (err) {
      errors.push(`admin_users.id=${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const row of serviceIntegrations) {
    try {
      const plain = decryptSecret(row.signingSecretEncrypted, oldKey);
      updates.push({ table: "serviceIntegration", id: row.id, reencrypted: encryptSecret(plain, newKey) });
    } catch (err) {
      errors.push(`service_integrations.id=${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const row of walletReferrals) {
    try {
      const plain = decryptSecret(row.referralTokenEncrypted, oldKey);
      updates.push({ table: "walletReferral", id: row.id, reencrypted: encryptSecret(plain, newKey) });
    } catch (err) {
      errors.push(`wallet_referrals.id=${row.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (errors.length > 0) {
    console.error(`エラー: ${errors.length}件の復号に失敗しました。DBは更新していません。`);
    for (const message of errors) console.error(`  - ${message}`);
    process.exitCode = 1;
    return;
  }

  await prisma.$transaction(
    updates.map((u) => {
      if (u.table === "adminUser") {
        return prisma.adminUser.update({ where: { id: u.id }, data: { mfaSecretEncrypted: u.reencrypted } });
      }
      if (u.table === "serviceIntegration") {
        return prisma.serviceIntegration.update({
          where: { id: u.id },
          data: { signingSecretEncrypted: u.reencrypted },
        });
      }
      return prisma.walletReferral.update({ where: { id: u.id }, data: { referralTokenEncrypted: u.reencrypted } });
    }),
  );

  console.log(`完了: ${updates.length}件を新鍵で再暗号化しました。`);
  console.log("次に、アプリのENCRYPTION_KEY環境変数を新鍵へ切り替えて再起動してください。");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
