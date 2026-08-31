import { formatOve, type RollForwardPeriod } from "@/lib/point-liability";

const COLUMNS = [
  "対象月",
  "期首残高",
  "発行",
  "利用",
  "失効",
  "発行の取消",
  "利用の取消",
  "期末残高",
  "差異",
];

/** 月次増減表。`期首 + 発行 − 利用 − 失効 − 発行取消 + 利用取消 ± その他 = 期末`。 */
export function RollForwardTable({ rows }: { rows: RollForwardPeriod[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] rounded-lg border border-sengoku-border bg-sengoku-navy text-right text-sm">
        <thead className="bg-sengoku-navy-deep text-xs text-sengoku-muted">
          <tr>
            {COLUMNS.map((label, i) => (
              <th key={label} className={`p-3 ${i === 0 ? "text-left" : "text-right"}`}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr className="border-t border-sengoku-border">
              <td colSpan={COLUMNS.length} className="p-6 text-center text-sengoku-muted">
                表示できる期間がありません
              </td>
            </tr>
          )}
          {rows.map((row) => {
            const hasDiscrepancy = row.discrepancy !== "0";
            return (
              <tr key={row.period} className="border-t border-sengoku-border">
                <td className="p-3 text-left">
                  {row.period}
                  {row.closingSource === "live" && (
                    <span className="ml-2 rounded bg-sengoku-navy-deep px-1.5 py-0.5 text-xs text-sengoku-muted">
                      集計中
                    </span>
                  )}
                </td>
                <td className="p-3">{row.openingBalance === null ? "-" : formatOve(row.openingBalance)}</td>
                <td className="p-3">{formatOve(row.movement.issued)}</td>
                <td className="p-3">{formatOve(row.movement.used)}</td>
                <td className="p-3">{formatOve(row.movement.expired)}</td>
                <td className="p-3">{formatOve(row.movement.reversedIssuance)}</td>
                <td className="p-3">{formatOve(row.movement.reversedUsage)}</td>
                <td className="p-3 font-bold">{formatOve(row.closingBalance)}</td>
                {/* 差異が0でなければ台帳を経由しない残高変更がある。見逃されないよう色を変える。 */}
                <td className={`p-3 ${hasDiscrepancy ? "font-bold text-sengoku-red" : "text-sengoku-muted"}`}>
                  {formatOve(row.discrepancy)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-sengoku-muted">
        「差異」は 期首 + 増減 と 期末 のずれです。0以外の場合、台帳を経由しない残高変更があることを意味します。
        「その他」(オンチェーン移行) はCSVに含まれます。
      </p>
    </div>
  );
}
