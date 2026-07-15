/**
 * Feature Flag (開発ガイドライン13章)。外部連携は初期状態OFFで段階的に有効化する。
 * すべて既定でfalse (未設定を含む) — OFFのままでも既存のログイン・残高表示・
 * 取引履歴・管理画面が壊れないことが前提であり、現時点ではどのコードもこれらの
 * フラグを参照していない (今後の連携実装がこのフラグを見て分岐する)。
 */
export const FEATURE_FLAG_KEYS = [
  "ENABLE_PLATFORM_USER_ID",
  "ENABLE_WALLET_REFERRAL_TOKEN",
  "ENABLE_AGENCY_REFERRAL_SYNC",
  "ENABLE_AGENCY_SYNC_RETRY",
  "ENABLE_WALLET_REGISTRATION_BONUS",
  "ENABLE_EXTERNAL_REWARD_TYPES",
  "ENABLE_ONCHAIN_MIGRATION",
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

export function isFeatureEnabled(key: FeatureFlagKey, env: NodeJS.ProcessEnv = process.env): boolean {
  return env[key] === "true";
}

export function getAllFeatureFlags(env: NodeJS.ProcessEnv = process.env): Record<FeatureFlagKey, boolean> {
  return Object.fromEntries(FEATURE_FLAG_KEYS.map((key) => [key, isFeatureEnabled(key, env)])) as Record<
    FeatureFlagKey,
    boolean
  >;
}
