import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}", "../../packages/shared-ui/src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // 既存の管理画面 (アカウント一覧など、今回のデザイン刷新対象外の画面) 向け
        brand: {
          50: "#eef2ff",
          500: "#4f46e5",
          600: "#4338ca",
          700: "#3730a3",
        },
        // 戦国ウォレット UIデザイン仕様 v1.0 (ダッシュボード画面で使用)
        // CSS変数 (globals.css) を参照し、ダーク/ライト両テーマに対応する。
        sengoku: {
          bg: "rgb(var(--sengoku-bg) / <alpha-value>)",
          surface: "rgb(var(--sengoku-surface) / <alpha-value>)",
          navy: "rgb(var(--sengoku-navy) / <alpha-value>)",
          "navy-deep": "rgb(var(--sengoku-navy-deep) / <alpha-value>)",
          red: "rgb(var(--sengoku-red) / <alpha-value>)",
          gold: "rgb(var(--sengoku-gold) / <alpha-value>)",
          "gold-soft": "rgb(var(--sengoku-gold-soft) / <alpha-value>)",
          green: "rgb(var(--sengoku-green) / <alpha-value>)",
          text: "rgb(var(--sengoku-text) / <alpha-value>)",
          muted: "rgb(var(--sengoku-muted) / <alpha-value>)",
          faint: "rgb(var(--sengoku-faint) / <alpha-value>)",
          border: "rgb(var(--sengoku-border) / <alpha-value>)",
          ink: "rgb(var(--sengoku-ink) / <alpha-value>)",
        },
      },
      fontFamily: {
        heading: ["var(--font-noto-serif-jp)", "serif"],
        sans: ["var(--font-noto-sans-jp)", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
