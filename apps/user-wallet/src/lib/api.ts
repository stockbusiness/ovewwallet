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

/**
 * ブラウザから直接NestJS APIを呼び出すクライアント側フェッチャー。
 * OVE独自セッションCookieは `credentials: "include"` で送受信する
 * (localhostではポートをまたいでも同一ドメインとしてCookieが共有される)。
 */
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
