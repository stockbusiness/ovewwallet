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

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
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
