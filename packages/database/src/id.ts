import { ulid } from "ulid";

/**
 * OVE_ACCOUNT_ID / OVE_WALLET_ID を含む内部主キーに使う ULID (26文字, 時系列ソート可能)。
 * LINEユーザーIDや戦国パスポート会員IDを主キーに流用しない (指示書 6章)。
 */
export function generateId(): string {
  return ulid();
}
