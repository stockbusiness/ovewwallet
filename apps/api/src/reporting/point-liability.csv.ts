import { toCsv } from "../common/csv";
import type { LiabilityRollForwardPeriod } from "./point-liability.types";

const HEADER = [
  "対象月",
  "期首残高",
  "発行",
  "利用",
  "失効",
  "発行の取消",
  "利用の取消",
  "その他増加",
  "その他減少",
  "期末残高",
  "期末残高の出所",
  "差異",
];

function closingSourceLabel(source: LiabilityRollForwardPeriod["closingSource"]): string {
  return source === "snapshot" ? "月末スナップショット" : "集計時点の実残高";
}

/**
 * 月次増減表のCSV。会計がそのまま表計算で扱える形にする。
 *
 * 桁区切りは入れない (再計算・集計の妨げになるため)。「差異」以外の数値列は
 * すべて0以上で、`common/csv.ts`のインジェクション対策で文字列化されることはない
 * (`point-liability.types.ts`の`LiabilityMovement`のコメント参照)。
 */
export function rollForwardToCsv(rows: LiabilityRollForwardPeriod[]): string {
  return toCsv(
    HEADER,
    rows.map((row) => [
      row.period,
      row.openingBalance ?? "",
      row.movement.issued,
      row.movement.used,
      row.movement.expired,
      row.movement.reversedIssuance,
      row.movement.reversedUsage,
      row.movement.otherIncrease,
      row.movement.otherDecrease,
      row.closingBalance,
      closingSourceLabel(row.closingSource),
      row.discrepancy,
    ]),
  );
}
