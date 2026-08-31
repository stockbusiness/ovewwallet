/**
 * 期間内の増減。
 *
 * **すべて0以上**にしてある。符号付きの純額にすると、CSVに負の数が出て
 * `common/csv.ts`のCSVインジェクション対策 (先頭が`-`の値に`'`を前置する) により
 * Excelで文字列扱いになり、合計が取れなくなるため。増減を借方・貸方に分けて
 * 並べるのは会計の増減表の書き方そのものでもある。
 */
export interface LiabilityMovement {
  /** 新規発行 (CREDIT。付与・ボーナス・移行時の期首残高など)。 */
  issued: string;
  /** 利用 (DEBIT。交換・購入など)。 */
  used: string;
  /** 有効期限切れによる失効 (EXPIRATION)。 */
  expired: string;
  /** 発行の取消 (REVERSALのうちDEBIT側)。負債を減らす。 */
  reversedIssuance: string;
  /** 利用の取消 (REVERSALのうちCREDIT側)。負債を戻す。 */
  reversedUsage: string;
  /** 上記以外による増加 (現状はオンチェーン移行の取消のみ)。 */
  otherIncrease: string;
  /** 上記以外による減少 (現状はオンチェーン移行のみ)。 */
  otherDecrease: string;
}

export interface LiabilityRollForwardPeriod {
  /** 対象月 (`YYYY-MM`)。 */
  period: string;
  /** 期首残高。前月末のスナップショット。無ければ null (遡れる範囲の最初の月)。 */
  openingBalance: string | null;
  movement: LiabilityMovement;
  /** 期末残高。スナップショットがあればその値、無ければ集計時点の実残高 (当月)。 */
  closingBalance: string;
  /** 期末残高がスナップショット由来か、集計時点の実残高か。 */
  closingSource: "snapshot" | "live";
  /**
   * `期首 + 増減` と `期末` の差。0が正常。
   * 0でなければ台帳を経由しない残高変更があることを意味する (要調査)。
   */
  discrepancy: string;
}

export interface ExpiryForecastBucket {
  /** 何日以内か。 */
  withinDays: number;
  /** その期間内に失効する見込みの合計。 */
  amount: string;
}

export interface CurrentLiability {
  /** 集計時刻。 */
  asOf: string;
  /** 発行済み未使用残高の合計 = SUM(available_balance + held_balance)。 */
  totalBalance: string;
  /** うち利用者が今すぐ使える分。 */
  availableBalance: string;
  /** うち管理者の保留により使えない分。 */
  heldBalance: string;
  /** うち有効期限付きロットの残。期限なしの分は totalBalance - expiringBalance。 */
  expiringBalance: string;
  /** 残高を持つウォレット数。 */
  walletsWithBalance: number;
  /** 失効見込み。 */
  expiryForecast: ExpiryForecastBucket[];
}
