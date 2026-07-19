export type TransactionDirection = "CREDIT" | "DEBIT";
export type StatusTone = "credit" | "success" | "warning" | "danger" | "neutral";

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

/** 取引ステータス・方向から StatusBadge の色調を決める。獲得=緑、利用=深紅、保留=金。 */
export function transactionStatusTone(status: string, direction: TransactionDirection): StatusTone {
  switch (status) {
    case "COMPLETED":
      return direction === "CREDIT" ? "credit" : "danger";
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
  SENGOKU_REGISTRATION_BONUS: "千の国パスポート登録特典",
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
  EXPIRATION: "OVE失効",
  DAILY_LOGIN_BONUS: "継続ログインボーナス",
};

/** サービスコード (ServiceCode enum) から画面表示用の日本語名を決める。 */
export const SERVICE_CODE_LABEL: Record<string, string> = {
  SENGOKU_PASSPORT: "千の国パスポート",
  AIART: "AIアート教室",
  SENGOKU_GACHA: "戦国ガチャ",
  SENGOKU_EC: "戦国EC",
  NFT_MARKET: "NFTマーケット",
  SENGOKU_METAVERSE: "戦国メタバース",
  EVENT_SYSTEM: "イベントシステム",
  AGENCY_SYSTEM: "代理店システム",
};
