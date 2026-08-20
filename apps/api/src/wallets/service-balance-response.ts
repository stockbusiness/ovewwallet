/**
 * PR-W2: `POST /api/v1/service/accounts/by-common-user-id/balance` 専用のレスポンス
 * 組み立て。既存の`GET :externalUserId/balance`(`WalletsService.getBalance()`)とは
 * 独立させ、既存エンドポイントのレスポンス契約には一切触れない(指示書V2レビュー指摘3)。
 * Nest起動・DBアクセスを伴わない純粋関数にすることで、Clockを固定した状態での
 * `as_of`の完全一致をユニットテストで直接検証できるようにする。
 */

export interface WalletBalanceSnapshot {
  status: string;
  availableBalance: string;
  pendingBalance: string;
  heldBalance: string;
  lifetimeCredited: string;
  lifetimeDebited: string;
}

export interface CommonUserBalanceResponse {
  available_balance: string;
  pending_balance: string;
  held_balance: string;
  lifetime_credited: string;
  lifetime_debited: string;
  currency: "OVE";
  /** このAPI呼び出しが正常にデータを返せたかどうか (wallet_status = Walletの業務状態とは別軸)。 */
  data_status: "ok";
  wallet_status: string;
  as_of: string;
}

export function buildCommonUserBalanceResponse(
  balance: WalletBalanceSnapshot,
  now: Date,
): CommonUserBalanceResponse {
  return {
    available_balance: balance.availableBalance,
    pending_balance: balance.pendingBalance,
    held_balance: balance.heldBalance,
    lifetime_credited: balance.lifetimeCredited,
    lifetime_debited: balance.lifetimeDebited,
    currency: "OVE",
    data_status: "ok",
    wallet_status: balance.status,
    as_of: now.toISOString(),
  };
}
