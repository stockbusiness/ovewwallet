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

export interface LoginDevice {
  id: string;
  device_label: string;
  ip_address: string | null;
  issued_at: string;
  last_used_at: string | null;
  is_current: boolean;
}

export interface DailyBonusStatus {
  claimed_today: boolean;
  current_streak: number;
  next_streak: number;
  next_amount: string;
}

export interface DailyBonusClaimResult {
  claimed_today: true;
  current_streak: number;
  amount: string;
}

export interface DailyBonusHistoryItem {
  claimed_date: string;
  streak_count: number;
  amount: string;
}

export type ReferralStatus =
  | { referred: false }
  | {
      referred: true;
      status: "PENDING" | "CONFIRMED" | "REJECTED" | "REVOKED";
      amount: string;
      confirmed_at: string | null;
      reason: string | null;
    };

export interface WalletHoldItem {
  id: string;
  amount: string;
  reason: string;
  held_at: string;
}

export interface ExpiringCreditsSummary {
  within_days: number;
  total_amount: string;
  nearest_expires_at: string | null;
}

export interface MeFeatureFlags {
  digital_collection_enabled: boolean;
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

export interface CollectibleAssetSummary {
  asset_code: string;
  name: string;
  description: string | null;
  image_url: string;
  thumbnail_url: string | null;
  rarity: string | null;
  category: string | null;
  edition_size: number | null;
}

export interface CollectibleOnchainInfo {
  network: string | null;
  chain_id: string | null;
  contract_address: string | null;
  token_id: string | null;
  transaction_hash: string | null;
  owner_address: string | null;
  minted_at: string | null;
}

export interface CollectibleHoldingSummary {
  holding_id: string;
  status: CollectibleHoldingStatus;
  /** PR#2最終修正 P1-4: マーケット側の不変値。未送信ならnull (画面では非表示にする)。 */
  serial_number: string | null;
  acquired_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  asset: CollectibleAssetSummary;
  onchain: CollectibleOnchainInfo;
}

export interface CollectibleListResponse {
  items: CollectibleHoldingSummary[];
  next_cursor: string | null;
}

export interface RewardRulePublic {
  rule_code: string;
  display_name: string;
  description: string | null;
  reward_amount: string;
  source_service: string;
  expiry_days: number | null;
}
