export type TransactionDirection = "CREDIT" | "DEBIT";
export type StatusTone = "success" | "warning" | "danger" | "neutral";

/** 取引ステータス・方向から、画面表示用の日本語ラベルを決める。 */
export function transactionStatusLabel(status: string, direction: TransactionDirection): string {
  switch (status) {
    case "COMPLETED":
      return direction === "CREDIT" ? "獲得" : "利用";
    case "HELD":
      return "保留中";
    case "REVERSED":
      return "取消済み";
    case "FAILED":
      return "失敗";
    default:
      return status;
  }
}

/** 取引ステータスから StatusBadge の色調を決める。 */
export function transactionStatusTone(status: string): StatusTone {
  switch (status) {
    case "COMPLETED":
      return "success";
    case "HELD":
      return "warning";
    case "REVERSED":
    case "FAILED":
      return "danger";
    default:
      return "neutral";
  }
}

/** 取引種別コードから画面表示用の日本語名を決める (仕様書に記載のない種別はそのまま返す)。 */
export const TRANSACTION_TYPE_LABEL: Record<string, string> = {
  SENGOKU_REGISTRATION_BONUS: "戦国パスポート登録特典",
  AIART_ATTENDANCE_REWARD: "AIアート教室参加特典",
  REGISTRATION_BONUS: "登録特典",
  AIART_ATTENDANCE: "AIアート教室参加特典",
  ADMIN_GRANT: "管理者付与",
  ADMIN_DEDUCTION: "管理者減算",
  ITEM_EXCHANGE: "アイテム交換",
  REVERSAL: "取消",
  HOLD: "保留",
  RELEASE: "保留解除",
  CAMPAIGN_REWARD: "キャンペーン特典",
};
