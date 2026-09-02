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
  /**
   * 千ノ国5システム改修 PR-W2: POST /api/v1/service/accounts/by-common-user-id/balance を
   * 有効化する。Flagが有効でも、呼び出し元ServiceIntegrationに
   * `wallet.balance.read.common-user` scope (ServiceIntegration.allowedScopes) が
   * 付与されていなければ403になる (Flagとscopeの両方が必要、`ServiceScopeGuard`参照)。
   */
  "ENABLE_COMMON_USER_BALANCE_API",
  /**
   * 退会済みアカウントの個人情報を猶予期間の経過後に匿名化する
   * (`docs/account-anonymization.md`)。
   *
   * 削除は**不可逆**で、猶予日数は法務の確認事項でもあるため、他のFlagと同様に既定OFF
   * にしている。有効化する前に管理画面のドライラン
   * (`GET /api/v1/admin/accounts/anonymization-preview`) で対象件数を確認すること。
   */
  "ENABLE_ACCOUNT_ANONYMIZATION",
  /**
   * 連携サービス一覧 (`/wallet/services`) とその導線を表示する。
   *
   * 稼働開始時点では連携先がすべて未連携で、サービス名も確定していないため、
   * 利用者には「未連携」ばかりが並ぶ意味の無い画面になる。他のFlagと同様に既定OFFで
   * 隠し、連携先とサービス名が固まってから有効化する。
   *
   * OFFでも連携そのもの (`/api/v1/me/linked-services` や外部サービス連携の実処理) は
   * 止めない。画面の出し分けだけを行う。
   */
  "ENABLE_LINKED_SERVICES",
] as const;

export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];

export function isFeatureEnabled(
  key: FeatureFlagKey,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[key] === "true";
}

export function getAllFeatureFlags(
  env: NodeJS.ProcessEnv = process.env,
): Record<FeatureFlagKey, boolean> {
  return Object.fromEntries(
    FEATURE_FLAG_KEYS.map((key) => [key, isFeatureEnabled(key, env)]),
  ) as Record<FeatureFlagKey, boolean>;
}
