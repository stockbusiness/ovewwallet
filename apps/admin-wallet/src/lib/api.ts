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

export interface AccountListItem {
  id: string;
  accountCode: string;
  status: string;
  displayName: string | null;
  primaryEmail: string | null;
  createdAt: string;
  wallet: { id: string; walletCode: string; availableBalance: string } | null;
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
