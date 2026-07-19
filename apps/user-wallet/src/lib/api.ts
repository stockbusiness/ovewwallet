export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * ブラウザから直接NestJS APIを呼び出すクライアント側フェッチャー。絶対URLではなく
 * 常に相対パスで呼び出す (`next.config.mjs`のrewritesが同一オリジンに見せかけて
 * 実際のAPIへ転送する)。iOS Safari/WebKitのITPがクロスサイトのセッションCookie
 * (SameSite=None)を制限する問題を避けるため(2026-07-18、詳細はnext.config.mjs参照)。
 * OVE独自セッションCookieは `credentials: "include"` で送受信する。
 */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
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

export interface WalletBalance {
  ove_account_id: string;
  wallet_id: string;
  wallet_code: string;
  status: string;
  available_balance: string;
  pending_balance: string;
  held_balance: string;
  lifetime_credited: string;
  lifetime_debited: string;
}

export interface TransactionSummary {
  id: string;
  transaction_code: string;
  transaction_type: string;
  direction: "CREDIT" | "DEBIT";
  amount: string;
  status: string;
  display_name: string;
  description: string | null;
  occurred_at: string;
}

export interface TransactionDetail extends TransactionSummary {
  wallet_id: string;
  balance_before: string;
  balance_after: string;
  source_service: string | null;
  source_reference_id: string | null;
  related_transaction_id: string | null;
  completed_at: string | null;
}

export interface OveAccount {
  id: string;
  accountCode: string;
  status: string;
  displayName: string | null;
  primaryEmail: string | null;
}

export interface LinkedService {
  service_code: string;
  service_name: string;
  linked: boolean;
  linked_at: string | null;
}

export interface Notice {
  id: string;
  title: string;
  message: string;
  importance: "NORMAL" | "IMPORTANT";
  published_at: string;
  is_read: boolean;
}

export interface WalletHoldItem {
  id: string;
  amount: string;
  reason: string;
  held_at: string;
}

export interface RewardRulePublic {
  rule_code: string;
  display_name: string;
  description: string | null;
  reward_amount: string;
  source_service: string;
  expiry_days: number | null;
}
