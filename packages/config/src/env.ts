import { z } from "zod";

/**
 * .env.example のキーと1:1対応。値が欠落/不正な場合は起動時に例外を投げる。
 * 実際のシークレット値はリポジトリへコミットしない。
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1).optional(),

  APP_URL: z.string().url(),
  API_URL: z.string().url(),
  ADMIN_URL: z.string().url(),

  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 chars"),
  COOKIE_DOMAIN: z.string().min(1),

  LINE_CHANNEL_ID: z.string().optional().default(""),
  LINE_CHANNEL_SECRET: z.string().optional().default(""),
  LINE_LIFF_ID: z.string().optional().default(""),
  LINE_CALLBACK_URL: z.string().optional().default(""),

  EMAIL_FROM: z.string().optional().default(""),
  EMAIL_PROVIDER: z.string().optional().default("mock"),
  EMAIL_API_KEY: z.string().optional().default(""),

  SENGOKU_SSO_CLIENT_ID: z.string().optional().default(""),
  SENGOKU_SSO_CLIENT_SECRET: z.string().optional().default(""),
  SENGOKU_SSO_EXCHANGE_URL: z.string().optional().default(""),

  ENCRYPTION_KEY: z.string().optional().default(""),
  AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(365),

  // エラートラッキング (Sentry, docs/monitoring.md)。未設定時は初期化しない。
  SENTRY_DSN: z.string().optional().default(""),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // 開発ガイドライン12.2章: LINE/戦国パスポートSSOの本番実装が未接続の間、
  // NODE_ENV=production では AUTH_MODE=production の明示指定を必須とする
  // (apps/api/src/common/assert-auth-mode.ts が起動時に検証する)。
  AUTH_MODE: z.enum(["mock", "production"]).default("mock"),

  // Feature Flag (開発ガイドライン13章): すべて既定でfalse。"true" を設定した場合のみ有効
  // (apps/api/src/common/feature-flags.ts が実際の判定に使う真実源であり、こちらは
  // .env.example との1:1対応を保つためのドキュメント目的のスキーマ)。
  ENABLE_PLATFORM_USER_ID: z.enum(["true", "false"]).default("false"),
  ENABLE_WALLET_REFERRAL_TOKEN: z.enum(["true", "false"]).default("false"),
  ENABLE_AGENCY_REFERRAL_SYNC: z.enum(["true", "false"]).default("false"),
  ENABLE_AGENCY_SYNC_RETRY: z.enum(["true", "false"]).default("false"),
  ENABLE_WALLET_REGISTRATION_BONUS: z.enum(["true", "false"]).default("false"),
  ENABLE_EXTERNAL_REWARD_TYPES: z.enum(["true", "false"]).default("false"),
  ENABLE_ONCHAIN_MIGRATION: z.enum(["true", "false"]).default("false"),
});

export type AppEnv = z.infer<typeof envSchema>;

let cached: AppEnv | undefined;

/**
 * process.env を検証してキャッシュする。フォールバック値の推測は行わない
 * (残高不明ユーザーに推定値を入れないのと同じ考え方を設定値にも適用する)。
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetEnvCacheForTests(): void {
  cached = undefined;
}
