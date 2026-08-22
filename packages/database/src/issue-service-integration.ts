import { encryptSecret, generateOpaqueToken, hashSecret } from "@ove/auth";
import { prisma } from "./client";
import { generateId } from "./id";

/**
 * 外部サービス連携(ServiceIntegration)のAPIキー・署名鍵の発行/ローテーション用スクリプト
 * (docs/runbooks/service-integration-key-lifecycle.md 参照)。
 *
 * `packages/database/src/seed.ts`にあった初回発行ロジック(APIキー・署名鍵の生成、
 * hashSecret/encryptSecretによる保存)を、個別のサービス単位で実行できるよう切り出した
 * ものであり、新しい暗号処理は書いていない。
 *
 * 冪等性: 対象のservice_codeの行が既に存在する場合、`--rotate`を指定しない限り
 * 何もしない(既存の鍵を上書きしない)。`--rotate`指定時は鍵のみを再生成し、
 * id・service_code・利用上限等の他フィールドは変更しない。
 *
 * 使い方:
 *   SERVICE_CODE=SENGOKU_PASSPORT ENCRYPTION_KEY=... pnpm --filter @ove/database issue-service-integration
 *   SERVICE_CODE=SENGOKU_PASSPORT ENCRYPTION_KEY=... pnpm --filter @ove/database issue-service-integration --rotate
 *
 * 出力される平文のAPIキー・署名鍵は、この実行時のターミナル出力にのみ表示される
 * (DBにはハッシュ・暗号化した値のみ保存し、以後Wallet側でも生値を再取得できない)。
 * ログ・Issue・PRコメント・チャット等へ貼り付けないこと。
 */
async function main() {
  const serviceCode = process.env.SERVICE_CODE;
  const encryptionKey = process.env.ENCRYPTION_KEY;
  const rotate = process.argv.includes("--rotate");

  if (!serviceCode) {
    console.error(
      "エラー: SERVICE_CODE を指定してください (例: SENGOKU_PASSPORT)",
    );
    process.exitCode = 1;
    return;
  }
  if (!encryptionKey) {
    console.error(
      "エラー: ENCRYPTION_KEY を指定してください (本番/staging用の実際の値を使うこと)",
    );
    process.exitCode = 1;
    return;
  }

  const existing = await prisma.serviceIntegration.findUnique({
    where: { serviceCode: serviceCode as never },
  });

  if (existing && !rotate) {
    console.log(
      `service_integrations に service_code="${serviceCode}" は既に存在します (id=${existing.id}, status=${existing.status})。` +
        " 何もしません。鍵を再生成する場合は --rotate を指定してください。",
    );
    return;
  }

  const apiKey = `ovk_${generateOpaqueToken(24)}`;
  const signingSecret = generateOpaqueToken(32);

  if (existing) {
    await prisma.serviceIntegration.update({
      where: { id: existing.id },
      data: {
        apiKeyHash: hashSecret(apiKey),
        signingSecretEncrypted: encryptSecret(signingSecret, encryptionKey),
      },
    });
    console.log(
      `ローテーション完了: service_code="${serviceCode}" (id=${existing.id})`,
    );
    console.log(
      "旧APIキー・署名鍵は直ちに無効になります。ロールバックはできません。",
    );
  } else {
    const created = await prisma.serviceIntegration.create({
      data: {
        id: generateId(),
        serviceCode: serviceCode as never,
        serviceName: serviceCode,
        apiKeyHash: hashSecret(apiKey),
        signingSecretEncrypted: encryptSecret(signingSecret, encryptionKey),
        allowedIps: [],
        dailyAmountLimit: 1_000_000,
        perRequestAmountLimit: 50_000,
      },
    });
    console.log(
      `新規発行完了: service_code="${serviceCode}" (id=${created.id})`,
    );
    console.log(
      "daily_amount_limit/per_request_amount_limitは既定値です。必要に応じて別途更新してください。",
    );
  }

  console.log(`  api_key: ${apiKey}`);
  console.log(`  signing_secret: ${signingSecret}`);
  console.log("(この値は二度と表示されません。安全な場所へ直接控えてください)");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
