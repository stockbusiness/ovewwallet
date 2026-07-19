/**
 * 千の国ウォレット UIデザイン仕様 v1.0 のデザイントークン (2026-07-19改訂)。
 * Tailwind設定 (各アプリの tailwind.config.ts) と実行時の値 (グラフの線色など) の
 * 両方から、この1箇所を正として参照する。実際の値はCSS変数 (globals.css) 側が
 * 正であり、この定数は変数導入前からの参照互換用 (現状このオブジェクト自体を
 * importしている箇所は無い)。
 */
export const colors = {
  background: "#0A1E3F",
  surface: "#10264D",
  deepNavy: "#163360",
  samuraiRed: "#B4533C",
  gold: "#C8A45A",
  softGold: "#E7D6A6",
  // 取引一覧・詳細の「獲得(CREDIT)」表示用。
  creditGreen: "#22C55E",
  textPrimary: "#FFFFFF",
  textSecondary: "#D1D5DB",
  textMuted: "#6B7280",
  border: "#D8D2C6",
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export const spacing = [4, 8, 10, 12, 24, 32, 40, 48, 64] as const;
