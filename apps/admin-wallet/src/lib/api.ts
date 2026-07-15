const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
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

export interface DashboardStats {
  totalAccounts: number;
  todayCredited: string;
  todayDebited: string;
  dailyTrend: Array<{ date: string; credited: string; debited: string }>;
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
  wallet: { id: string; walletCode: string; availableBalance: string; status: string } | null;
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

export interface ApprovalRequestItem {
  id: string;
  requestType: string;
  status: string;
  requestedBy: string;
  requestedAt: string;
  approvedBy: string | null;
  decidedAt: string | null;
  rejectionReason: string | null;
  payload: { kind: string; walletId: string; amount: string; reason: string };
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

export type FeatureFlags = Record<
  | "ENABLE_PLATFORM_USER_ID"
  | "ENABLE_WALLET_REFERRAL_TOKEN"
  | "ENABLE_AGENCY_REFERRAL_SYNC"
  | "ENABLE_AGENCY_SYNC_RETRY"
  | "ENABLE_WALLET_REGISTRATION_BONUS"
  | "ENABLE_EXTERNAL_REWARD_TYPES"
  | "ENABLE_ONCHAIN_MIGRATION",
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
};
