/**
 * 戦国ウォレット UIデザイン仕様 v1.0 のデザイントークン。
 * Tailwind設定 (各アプリの tailwind.config.ts) と実行時の値 (グラフの線色など) の
 * 両方から、この1箇所を正として参照する。
 */
export const colors = {
  background: "#0E0E11",
  surface: "#0B0B0D",
  deepNavy: "#0F1626",
  samuraiRed: "#B3202A",
  gold: "#D4AF37",
  softGold: "#F5E6B3",
  textPrimary: "#FFFFFF",
  textSecondary: "#BFBFBF",
  textMuted: "#7A7A7A",
  border: "#2A2A2E",
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

export const spacing = [4, 8, 10, 12, 24, 32, 40, 48, 64] as const;
