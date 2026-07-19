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
        sengoku: {
          bg: "#0E0E11",
          surface: "#0B0B0D",
          navy: "#0F1626",
          red: "#B3202A",
          gold: "#D4AF37",
          "gold-soft": "#F5E6B3",
          green: "#35B072",
          muted: "#BFBFBF",
          faint: "#7A7A7A",
          border: "#2A2A2E",
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
