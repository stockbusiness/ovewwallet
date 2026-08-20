/**
 * Feature Flag (開発ガイドライン13章)。外部連携は初期状態OFFで段階的に有効化する。
 * すべて既定でfalse (未設定を含む) — OFFのままでも既存のログイン・残高表示・
 * 取引履歴・管理画面が壊れないことが前提。
 */
export const FEATURE_FLAG_KEYS = [
  "ENABLE_PLATFORM_USER_ID",
  "ENABLE_WALLET_REFERRAL_TOKEN",
  "ENABLE_AGENCY_REFERRAL_SYNC",
  "ENABLE_AGENCY_SYNC_RETRY",
  "ENABLE_WALLET_REGISTRATION_BONUS",
  "ENABLE_EXTERNAL_REWARD_TYPES",
  "ENABLE_ONCHAIN_MIGRATION",
  /** 千ノ国 全体統合 共通実装契約 (2026-07-21) の POST /api/integrations/events を有効化する。 */
  "ENABLE_COMMON_EVENT_INBOX",
  /** NFTコレクション実装指示書: ユーザー向けコレクションAPI・画面導線を有効化する。 */
  "ENABLE_DIGITAL_COLLECTION",
  /** 同指示書: entitlement.granted/entitlement.revokedの共通イベントHandlerを有効化する。 */
  "ENABLE_COLLECTIBLE_ENTITLEMENT_INBOX",
  /** NFTカードClaim導線実装指示書: /claim/{token}画面・Claim概要/確定APIを有効化する。 */
  "ENABLE_COLLECTIBLE_CLAIM_FLOW",
  /**
   * 千ノ国5システム改修 PR-W1: 旧登録時3,000 OVE紹介特典の新規PENDING作成を許可する。
   * 他のFlagと異なり、trueが「旧挙動を維持する」側であることに注意
   * (デフォルト・未設定・false・不正値はすべて「新規作成しない」側になる、安全側デフォルト)。
   * 既存のPENDING/CONFIRMED/REJECTED履歴やOVE残高には一切影響しない
   * (`AttachReferralToAccountUseCase.attachToNewAccount`参照)。
   */
  "ENABLE_LEGACY_REFERRAL_SIGNUP_BONUS",
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
