import { hashSecret, encryptSecret, generateOpaqueToken } from "@ove/auth";
import { prisma } from "./client";
import { generateId } from "./id";
import { ACCOUNT_CODE_COUNTER, TRANSACTION_CODE_COUNTER, WALLET_CODE_COUNTER } from "./codes";

const SERVICE_CODES = [
  "SENGOKU_PASSPORT",
  "AIART",
  "SENGOKU_GACHA",
  "SENGOKU_EC",
  "NFT_MARKET",
  "SENGOKU_METAVERSE",
  "EVENT_SYSTEM",
] as const;

async function main() {
  console.log("Seeding initial data...");

  // カウンタ初期化 (存在しない場合のみ)
  for (const key of [ACCOUNT_CODE_COUNTER, WALLET_CODE_COUNTER, TRANSACTION_CODE_COUNTER]) {
    await prisma.codeCounter.upsert({
      where: { id: key },
      update: {},
      create: { id: key, nextValue: 1 },
    });
  }

  // 初期管理者 (SUPER_ADMIN) — パスワードは初回ログイン後に必ず変更すること
  const adminEmail = "admin@ovewallet.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? generateOpaqueToken(12);
  await prisma.adminUser.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      id: generateId(),
      adminCode: "OVE-ADM-00000001",
      email: adminEmail,
      passwordHash: hashSecret(adminPassword),
      role: "SUPER_ADMIN",
      displayName: "Initial Super Admin",
    },
  });
  console.log(`  admin_users: ${adminEmail} / password=${adminPassword} (must be rotated)`);

  // 外部サービス連携の初期レコード。APIキー・署名シークレットは生成時のみ表示し、
  // ハッシュ化した値だけをDBへ保存する。
  for (const serviceCode of SERVICE_CODES) {
    const existing = await prisma.serviceIntegration.findUnique({ where: { serviceCode } });
    if (existing) continue;

    const apiKey = `ovk_${generateOpaqueToken(24)}`;
    const signingSecret = generateOpaqueToken(32);
    const encryptionKey = process.env.ENCRYPTION_KEY || "dev-only-insecure-encryption-key";

    await prisma.serviceIntegration.create({
      data: {
        id: generateId(),
        serviceCode,
        serviceName: serviceCode,
        apiKeyHash: hashSecret(apiKey),
        signingSecretEncrypted: encryptSecret(signingSecret, encryptionKey),
        allowedIps: [],
        dailyAmountLimit: 1_000_000,
        perRequestAmountLimit: 50_000,
      },
    });
    console.log(`  service_integrations: ${serviceCode} apiKey=${apiKey} signingSecret=${signingSecret}`);
  }

  // 初期付与ルール (指示書9章)
  await prisma.rewardRule.upsert({
    where: { ruleCode: "SENGOKU_REGISTRATION_BONUS" },
    update: {},
    create: {
      id: generateId(),
      ruleCode: "SENGOKU_REGISTRATION_BONUS",
      ruleName: "戦国パスポート登録特典",
      sourceService: "SENGOKU_PASSPORT",
      rewardAmount: 3000,
      perUserLimit: 1,
      approvalType: "AUTOMATIC",
      status: "ACTIVE",
      displayName: "戦国パスポート登録特典",
      description: "戦国パスポート会員登録完了時に付与される特典。",
    },
  });

  await prisma.rewardRule.upsert({
    where: { ruleCode: "AIART_ATTENDANCE_REWARD" },
    update: {},
    create: {
      id: generateId(),
      ruleCode: "AIART_ATTENDANCE_REWARD",
      ruleName: "AIアート教室参加特典",
      sourceService: "AIART",
      rewardAmount: 10000,
      perEventLimit: 1,
      approvalType: "AUTOMATIC",
      status: "ACTIVE",
      displayName: "AIアート教室参加特典",
      description: "AIアート教室への実参加が確認された場合に付与される特典。",
    },
  });

  console.log("Seed complete.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
