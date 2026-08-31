/** ポイント負債レポートのAPI応答 (apps/api/src/reporting/point-liability.types.ts と対応)。 */

export interface LiabilityMovement {
  issued: string;
  used: string;
  expired: string;
  reversedIssuance: string;
  reversedUsage: string;
  otherIncrease: string;
  otherDecrease: string;
}

export interface RollForwardPeriod {
  period: string;
  openingBalance: string | null;
  movement: LiabilityMovement;
  closingBalance: string;
  closingSource: "snapshot" | "live";
  discrepancy: string;
}

export interface ExpiryForecastBucket {
  withinDays: number;
  amount: string;
}

export interface CurrentLiability {
  asOf: string;
  totalBalance: string;
  availableBalance: string;
  heldBalance: string;
  expiringBalance: string;
  walletsWithBalance: number;
  expiryForecast: ExpiryForecastBucket[];
}

/** 金額の表示。桁が大きいので必ず桁区切りを入れる。 */
export function formatOve(value: string): string {
  return Number(value).toLocaleString("ja-JP");
}
