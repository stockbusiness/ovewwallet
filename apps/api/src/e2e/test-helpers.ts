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

export interface TestCommonEventSigningKey {
  keyId: string;
  secret: string;
}

/** 千ノ国 全体統合 共通実装契約 6.1章のcommon_event_signing_keysテスト用鍵を発行する。 */
export async function createTestCommonEventSigningKey(sourceSystemKey = "agency-system"): Promise<TestCommonEventSigningKey> {
  const keyId = `test-key-${generateId()}`;
  const secret = `common-event-secret-${generateId()}`;

  await prisma.commonEventSigningKey.create({
    data: {
      id: generateId(),
      keyId,
      sourceSystemKey,
      secretEncrypted: encryptSecret(secret, ENCRYPTION_KEY),
      status: "ACTIVE",
    },
  });

  return { keyId, secret };
}

/** 共通実装契約6.1章のX-SenNoKuni-*ヘッダーを組み立てる。 */
export function commonEventSignedHeaders(key: TestCommonEventSigningKey, body: unknown): Record<string, string> {
  const bodyJson = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = generateId();
  const signature = hmacSign(key.secret, `${timestamp}.${bodyJson}`);

  return {
    "X-SenNoKuni-Key-Id": key.keyId,
    "X-SenNoKuni-Timestamp": timestamp,
    "X-SenNoKuni-Nonce": nonce,
    "X-SenNoKuni-Signature": signature,
    "Idempotency-Key": (body as { event_id?: string })?.event_id ?? "",
    "X-Event-Version": (body as { event_version?: string })?.event_version ?? "1.0",
  };
}
