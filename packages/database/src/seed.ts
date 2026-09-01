import { hashSecret, encryptSecret, generateOpaqueToken } from "@ove/auth";
import { prisma } from "./client";
import { generateId } from "./id";
import {
  ACCOUNT_CODE_COUNTER,
  ADMIN_CODE_COUNTER,
  TRANSACTION_CODE_COUNTER,
  WALLET_CODE_COUNTER,
  nextDisplayCode,
} from "./codes";

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
  for (const key of [
    ACCOUNT_CODE_COUNTER,
    WALLET_CODE_COUNTER,
    TRANSACTION_CODE_COUNTER,
    ADMIN_CODE_COUNTER,
  ]) {
    await prisma.codeCounter.upsert({
      where: { id: key },
      update: {},
      create: { id: key, nextValue: 1 },
    });
  }

  // 初期管理者 (SUPER_ADMIN)。2人目以降は管理画面 (POST /api/v1/admin/admins) から
  // 追加でき、この初期パスワードも POST /api/v1/admin/password で本人が変更できる。
  // admin_code は固定値ではなくカウンタから採番する (管理者追加APIと同じ採番列を使い、
  // 番号が衝突しないようにするため)。
  const adminEmail = "admin@ovewallet.local";
  const existingAdmin = await prisma.adminUser.findUnique({ where: { email: adminEmail } });
  if (existingAdmin) {
    console.log(`  admin_users: ${adminEmail} (already exists, skipped)`);
  } else {
    const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? generateOpaqueToken(12);
    await prisma.adminUser.create({
      data: {
        id: generateId(),
        adminCode: await nextDisplayCode(prisma, ADMIN_CODE_COUNTER, "OVE-ADM"),
        email: adminEmail,
        passwordHash: hashSecret(adminPassword),
        role: "SUPER_ADMIN",
        displayName: "Initial Super Admin",
      },
    });
    console.log(`  admin_users: ${adminEmail} / password=${adminPassword} (must be rotated)`);
  }

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

  // 戦国経済圏代理店システム(sengoku-ai.com)向けAPIキー (外部連携API仕様書5章)。
  // 開発ガイドライン9.1章の方針により、既存のServiceIntegrationを再利用する
  // (ServiceCode.AGENCY_SYSTEM)。ただし相手システムはHMAC署名に対応していない
  // ため、signingSecretは実際には検証に使わないダミー値を保存するだけになる
  // (認証はAgencyApiKeyGuardによるx-api-key/Bearerの単純な鍵照合のみ)。
  const existingAgencyIntegration = await prisma.serviceIntegration.findUnique({
    where: { serviceCode: "AGENCY_SYSTEM" },
  });
  if (!existingAgencyIntegration) {
    const partnerApiKey = `oveagn_${generateOpaqueToken(24)}`;
    const unusedSigningSecret = generateOpaqueToken(32);
    const encryptionKey = process.env.ENCRYPTION_KEY || "dev-only-insecure-encryption-key";

    await prisma.serviceIntegration.create({
      data: {
        id: generateId(),
        serviceCode: "AGENCY_SYSTEM",
        serviceName: "戦国経済圏代理店システム (sengoku-ai.com)",
        apiKeyHash: hashSecret(partnerApiKey),
        signingSecretEncrypted: encryptSecret(unusedSigningSecret, encryptionKey),
        allowedIps: [],
        dailyAmountLimit: 0,
        perRequestAmountLimit: 0,
      },
    });
    console.log(`  service_integrations: AGENCY_SYSTEM apiKey=${partnerApiKey}`);
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
      // 案内先URL (LINE友だち追加等) は管理画面から設定する。ここでは未設定にしておく
      // (誤ったURLを既定値として配布しないため。docs/reward-landing-url.md参照)。
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
