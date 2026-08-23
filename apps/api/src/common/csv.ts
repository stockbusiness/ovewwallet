/** Excel(日本語版)でも文字化けせず開けるよう先頭に付与するUTF-8 BOM。 */
export const CSV_BOM = "﻿";

/**
 * CSVインジェクション対策(OWASP推奨)。先頭が`=`/`+`/`-`/`@`のフィールドは、
 * Excel/Google Sheets等で開いたときに数式として評価されうる。値自体は連携先が
 * 制御する自由記述(external_user_id等)が含まれうるため、先頭に`'`を前置して
 * 数式として解釈されないようにする(表示上は先頭の`'`が付くだけで、値の
 * 意味は変えない)。
 */
function neutralizeFormulaPrefix(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function csvEscapeField(value: string): string {
  const neutralized = neutralizeFormulaPrefix(value);
  if (/[",\r\n]/.test(neutralized)) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }
  return neutralized;
}

/** ヘッダー行込みの2次元配列をCSV文字列に変換する (BOM付き)。 */
export function toCsv(header: string[], rows: string[][]): string {
  return (
    CSV_BOM +
    [header, ...rows]
      .map((row) => row.map(csvEscapeField).join(","))
      .join("\r\n")
  );
}
