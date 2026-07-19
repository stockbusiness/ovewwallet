/** Excel(日本語版)でも文字化けせず開けるよう先頭に付与するUTF-8 BOM。 */
export const CSV_BOM = "﻿";

function csvEscapeField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** ヘッダー行込みの2次元配列をCSV文字列に変換する (BOM付き)。 */
export function toCsv(header: string[], rows: string[][]): string {
  return CSV_BOM + [header, ...rows].map((row) => row.map(csvEscapeField).join(",")).join("\r\n");
}
