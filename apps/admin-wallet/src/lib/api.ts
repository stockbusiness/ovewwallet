export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...options.headers },
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : undefined;

  if (!res.ok) {
    throw new ApiError(res.status, body?.message ?? res.statusText);
  }
  return body as T;
}

export interface AdminMe {
  id: string;
  email: string;
  role: string;
  displayName: string;
  mfaEnabled: boolean;
}

/**
 * 管理者パスワードの最小長。入力前に気づけるようにする画面側のヒントで、
 * 実際の強制は API 側 (`apps/api/src/admin/dto/admin-users.dto.ts` の
 * `ADMIN_PASSWORD_MIN_LENGTH`) が行う。値を変えるときは両方を揃えること。
 */
export const ADMIN_PASSWORD_MIN_LENGTH = 12;

export const ADMIN_ROLES = [
  "SUPER_ADMIN",
  "OVE_OPERATOR",
  "INTEGRATION_ADMIN",
  "EVENT_OPERATOR",
  "AUDITOR",
  "VIEWER",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

/** ロールの日本語表記。APIが返すのは英語の列挙値のみのため、表示側で対応付ける。 */
export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  SUPER_ADMIN: "スーパー管理者",
  OVE_OPERATOR: "ORI運用",
  INTEGRATION_ADMIN: "連携管理",
  EVENT_OPERATOR: "イベント運用",
  AUDITOR: "監査",
  VIEWER: "閲覧のみ",
};

/** GET /api/v1/admin/admins の1件。`ADMIN_USER_FIELDS` (apps/api) と対応する。 */
export interface AdminUser {
  id: string;
  adminCode: string;
  email: string;
  role: AdminRole;
  status: "ACTIVE" | "SUSPENDED";
  displayName: string;
  mfaEnabled: boolean;
  mfaEnrolledAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** POST /api/v1/admin/admins の応答。初期パスワードはこの1回だけ返る。 */
export interface CreatedAdminUser {
  admin: AdminUser;
  initialPassword: string;
}

export interface DashboardStats {
  totalAccounts: number;
  todayCredited: string;
  todayDebited: string;
  dailyTrend: Array<{ date: string; credited: string; debited: string }>;
}

export interface RankDistributionItem {
  name: string;
  count: number;
}

export interface WalletListItem {
  id: string;
  walletCode: string;
  status: string;
  availableBalance: string;
  heldBalance: string;
  lifetimeCredited: string;
  lifetimeDebited: string;
  account: { accountCode: string; status: string; displayName: string | null };
}

export interface RewardRuleItem {
  id: string;
  ruleCode: string;
  ruleName: string;
  sourceService: string;
  rewardAmount: string;
  perUserLimit: number | null;
  perEventLimit: number | null;
  monthlyCountLimit: number | null;
  monthlyAmountLimit: string | null;
  globalAmountLimit: string | null;
  startsAt: string | null;
  endsAt: string | null;
  approvalType: string;
  status: string;
  displayName: string;
  description: string | null;
  expiryDays: number | null;
  /** 参加方法の案内先URL (LINE友だち追加など)。nullなら利用者側に導線を出さない。 */
  landingUrl: string | null;
}

export interface RewardRuleIssuanceSummaryItem {
  ruleCode: string;
  displayName: string;
  totalAmount: string | null;
  count: number | null;
}

export interface NoticeItem {
  id: string;
  title: string;
  message: string;
  status: "PUBLISHED" | "DRAFT" | "ARCHIVED";
  importance: "NORMAL" | "IMPORTANT";
  publishedAt: string;
  createdBy: string;
  createdAt: string;
}

export interface TransactionItem {
  id: string;
  transaction_code: string;
  wallet_id: string;
  account_code: string;
  transaction_type: string;
  direction: "CREDIT" | "DEBIT";
  amount: string;
  status: string;
  display_name: string;
  description: string | null;
  occurred_at: string;
}

export interface AccountListItem {
  id: string;
  accountCode: string;
  status: string;
  displayName: string | null;
  primaryEmail: string | null;
  createdAt: string;
  wallet: { id: string; walletCode: string; availableBalance: string } | null;
}

export interface AccountDetailItem {
  id: string;
  accountCode: string;
  status: string;
  displayName: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  verificationLevel: number;
  createdAt: string;
  closedAt: string | null;
  wallet: {
    id: string;
    walletCode: string;
    availableBalance: string;
    status: string;
  } | null;
  identities: Array<{
    id: string;
    identityType: string;
    provider: string;
    providerSubject: string;
    email: string | null;
    status: string;
    createdAt: string;
  }>;
  links: Array<{
    id: string;
    externalUserId: string;
    status: string;
    linkMethod: string;
    linkedAt: string;
    serviceIntegration: { serviceCode: string; serviceName: string };
  }>;
  mergedIntoAccount: { id: string; accountCode: string } | null;
  mergedAccounts: Array<{ id: string; accountCode: string }>;
  auditLogs: AuditLogItem[];
  activeSessionCount: number;
}

export interface AuditLogItem {
  id: string;
  actorType: string;
  actorId: string | null;
  actionType: string;
  targetType: string;
  targetId: string | null;
  result: string;
  reason: string | null;
  createdAt: string;
}

export interface ApiAccessLogItem {
  id: string;
  serviceIntegrationId: string | null;
  serviceCode: string | null;
  serviceName: string | null;
  apiKeyPrefix: string | null;
  method: string;
  path: string;
  statusCode: number;
  sourceIp: string | null;
  requestId: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface ServiceIntegrationItem {
  id: string;
  serviceCode: string;
  serviceName: string;
  status: string;
  allowedIps: string[];
  dailyAmountLimit: string;
  perRequestAmountLimit: string;
  lastAccessedAt: string | null;
  createdAt: string;
}

export interface CommonUserHubConfig {
  baseUrl: string;
  systemKey: string;
  apiKeySet: boolean;
  apiKeyPreview: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface ApprovalRequestItem {
  id: string;
  requestType: string;
  status: string;
  requestedBy: string;
  requestedAt: string;
  approvedBy: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  payload:
    | {
        kind: "HIGH_VALUE_GRANT" | "HIGH_VALUE_DEDUCTION";
        walletId: string;
        amount: string;
        reason: string;
      }
    | {
        kind: "ACCOUNT_MERGE";
        sourceAccountCode: string;
        targetAccountCode: string;
        reason: string;
      }
    | {
        kind: "MIGRATION_EXECUTION";
        batchName: string;
        fileName: string;
        csvContent: string;
        reason: string;
      };
}

export interface MigrationSummary {
  batchId: string;
  totalCount: number;
  successCount: number;
  reviewingCount: number;
  errorCount: number;
  results: Array<{
    row: number;
    oldUserId: string;
    status: "SUCCESS" | "REVIEWING" | "ERROR";
    message?: string;
  }>;
}

export interface ReconciliationResult {
  checkedWalletCount: number;
  mismatchedWalletCount: number;
  mismatched: Array<{
    walletId: string;
    walletCode: string;
    computedBalance: string;
    cachedBalance: string;
    difference: string;
  }>;
}

export interface OutboxEventItem {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  destinationService: string;
  status: "PENDING" | "PROCESSING" | "SENT" | "FAILED";
  attemptCount: number;
  availableAt: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
}

/** 代理店連携状態一覧 (開発ガイドライン15章)。account_links のうちAGENCY_SYSTEM分。 */
export interface AgencyLinkItem {
  id: string;
  externalUserId: string;
  status: "PENDING" | "ACTIVE" | "REVOKED";
  linkMethod: string;
  linkedAt: string;
  verifiedAt: string | null;
  revokedAt: string | null;
  metadata: Record<string, unknown> | null;
  account: {
    id: string;
    accountCode: string;
    displayName: string | null;
  } | null;
}

/** 代理店紹介トークン受け入れ (実装指示書 v1.0)。/invite/{token} 受付〜登録特典の確認用。 */
export interface WalletReferralBenefitItem {
  id: string;
  benefitType: string;
  amount: string;
  status: "PENDING" | "CONFIRMED" | "REJECTED" | "REVOKED";
  confirmedAt: string | null;
  rejectedAt: string | null;
  revokedAt: string | null;
  reason: string | null;
}

export interface WalletReferralItem {
  id: string;
  walletUserId: string | null;
  commonUserId: string | null;
  agencyId: string | null;
  status:
    | "CAPTURED"
    | "PENDING"
    | "CONFIRMED"
    | "REJECTED"
    | "MANUALLY_CONFIRMED"
    | "CANCELLED"
    | "ERROR"
    | "EXPIRED";
  source: string;
  capturedAt: string;
  expiresAt: string;
  usedAt: string | null;
  registeredAt: string | null;
  confirmedAt: string | null;
  rejectedAt: string | null;
  revokedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  reason: string | null;
  createdAt: string;
  account: {
    id: string;
    accountCode: string;
    displayName: string | null;
  } | null;
  benefits: WalletReferralBenefitItem[];
}

export type FeatureFlags = Record<
  | "ENABLE_PLATFORM_USER_ID"
  | "ENABLE_WALLET_REFERRAL_TOKEN"
  | "ENABLE_AGENCY_REFERRAL_SYNC"
  | "ENABLE_AGENCY_SYNC_RETRY"
  | "ENABLE_WALLET_REGISTRATION_BONUS"
  | "ENABLE_EXTERNAL_REWARD_TYPES"
  | "ENABLE_ONCHAIN_MIGRATION"
  | "ENABLE_COMMON_EVENT_INBOX"
  | "ENABLE_DIGITAL_COLLECTION"
  | "ENABLE_COLLECTIBLE_ENTITLEMENT_INBOX"
  | "ENABLE_COLLECTIBLE_CLAIM_FLOW"
  | "ENABLE_LEGACY_REFERRAL_SIGNUP_BONUS"
  | "ENABLE_COMMON_USER_BALANCE_API",
  boolean
>;

export const FEATURE_FLAG_LABELS: Record<keyof FeatureFlags, string> = {
  ENABLE_PLATFORM_USER_ID: "共通プラットフォームユーザーID",
  ENABLE_WALLET_REFERRAL_TOKEN: "紹介トークン受け取り",
  ENABLE_AGENCY_REFERRAL_SYNC: "代理店紹介関係の同期",
  ENABLE_AGENCY_SYNC_RETRY: "代理店同期の自動再送",
  ENABLE_WALLET_REGISTRATION_BONUS: "登録ボーナス連携",
  ENABLE_EXTERNAL_REWARD_TYPES: "外部サービス起点の付与種別",
  ENABLE_ONCHAIN_MIGRATION: "オンチェーン移行",
  ENABLE_COMMON_EVENT_INBOX: "共通イベント受信口",
  ENABLE_DIGITAL_COLLECTION: "NFTコレクション機能",
  ENABLE_COLLECTIBLE_ENTITLEMENT_INBOX: "NFTコレクション entitlement受信",
  ENABLE_COLLECTIBLE_CLAIM_FLOW: "NFTカードClaim導線",
  ENABLE_LEGACY_REFERRAL_SIGNUP_BONUS:
    "旧登録特典(3,000 ORI)の新規発生(true=旧挙動維持)",
  ENABLE_COMMON_USER_BALANCE_API:
    "common_user_id起点の残高照会API(要scope付与)",
};

/** 共通イベント契約6.2章の必須イベントのうち、Signing Key発行時に選択可能な種別 (`apps/api/src/common-events/`の`COMMON_EVENT_HANDLED_TYPES`と対応)。 */
export const COMMON_EVENT_SIGNING_KEY_EVENT_TYPES = [
  "common_user.resolved",
  "common_user.merged",
  "customer.assignment.changed",
  "referral.confirmed",
  "reward.granted",
  "reward.reversed",
  "entitlement.granted",
  "entitlement.revoked",
] as const;

export interface CommonEventSigningKeyItem {
  id: string;
  keyId: string;
  sourceSystemKey: string;
  allowedEventTypes: string[];
  status: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface CollectibleAssetItem {
  id: string;
  assetCode: string;
  productCode: string | null;
  name: string;
  description: string | null;
  imageUrl: string;
  thumbnailUrl: string | null;
  imageHash: string | null;
  rarity: string | null;
  category: string | null;
  editionSize: number | null;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
}

export type CollectibleHoldingStatus =
  | "ACTIVE"
  | "REVOKED"
  | "MINT_READY"
  | "MINTING"
  | "ONCHAIN"
  | "TRANSFERRED"
  | "BURNED"
  | "ERROR";

export interface CollectibleHoldingItem {
  id: string;
  oveAccountId: string;
  collectibleAssetId: string;
  entitlementId: string;
  sourceSystemKey: string;
  orderId: string | null;
  orderItemId: string | null;
  acquiredAt: string;
  status: CollectibleHoldingStatus;
  revokedAt: string | null;
  // PR-W3-a: 外部システムからの自由記述(revokeReason)は通常のAPIから返らない。
  // revokeReasonCodeを固定文言表(collectible-revoke-reason.ts)へマッピングして表示する。
  revokeReasonCode: string | null;
  revokedBySourceSystemKey: string | null;
  revokedByEventId: string | null;
  revokedCorrelationId: string | null;
  revokedOccurredAt: string | null;
  network: string | null;
  chainId: string | null;
  contractAddress: string | null;
  tokenId: string | null;
  transactionHash: string | null;
  ownerAddress: string | null;
  mintedAt: string | null;
  createdAt: string;
  updatedAt: string;
  asset: CollectibleAssetItem;
  account?: {
    id: string;
    accountCode: string;
    commonUserId: string | null;
  } | null;
}
