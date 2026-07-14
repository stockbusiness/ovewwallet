import { hashSecret, encryptSecret, hmacSign } from "@ove/auth";
import { generateId, prisma } from "@ove/database";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "test-only-insecure-encryption-key";

export interface TestServiceIntegration {
  id: string;
  apiKey: string;
  signingSecret: string;
}

export async function createTestServiceIntegration(
  serviceCode: string,
  overrides: Partial<{ perRequestAmountLimit: number; dailyAmountLimit: number }> = {},
): Promise<TestServiceIntegration> {
  const apiKey = `ovk_test_${generateId()}`;
  const signingSecret = `secret_test_${generateId()}`;

  // 同じ service_code のテストが複数回走っても衝突しないよう upsert する
  // (service_code に一意制約があるため)。
  const integration = await prisma.serviceIntegration.upsert({
    where: { serviceCode: serviceCode as never },
    update: {
      apiKeyHash: hashSecret(apiKey),
      signingSecretEncrypted: encryptSecret(signingSecret, ENCRYPTION_KEY),
      dailyAmountLimit: overrides.dailyAmountLimit ?? 1_000_000,
      perRequestAmountLimit: overrides.perRequestAmountLimit ?? 50_000,
      status: "ACTIVE",
    },
    create: {
      id: generateId(),
      serviceCode: serviceCode as never,
      serviceName: `${serviceCode} (test)`,
      apiKeyHash: hashSecret(apiKey),
      signingSecretEncrypted: encryptSecret(signingSecret, ENCRYPTION_KEY),
      allowedIps: [],
      dailyAmountLimit: overrides.dailyAmountLimit ?? 1_000_000,
      perRequestAmountLimit: overrides.perRequestAmountLimit ?? 50_000,
    },
  });

  return { id: integration.id, apiKey, signingSecret };
}

export function signedHeaders(
  integration: TestServiceIntegration,
  method: string,
  path: string,
  body: unknown,
): Record<string, string> {
  const bodyJson = JSON.stringify(body);
  const timestamp = String(Date.now());
  const nonce = generateId();
  const canonicalPayload = `${method}:${path}:${bodyJson}`;
  const signature = hmacSign(integration.signingSecret, `${timestamp}.${nonce}.${canonicalPayload}`);

  return {
    "X-OVE-Api-Key": integration.apiKey,
    "X-OVE-Timestamp": timestamp,
    "X-OVE-Nonce": nonce,
    "X-OVE-Signature": signature,
  };
}
