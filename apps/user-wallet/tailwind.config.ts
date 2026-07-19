import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}", "../../packages/shared-ui/src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // 旧テーマ (未移行ページ向けに残す)
        brand: {
          50: "#fef6ea",
          500: "#d9822b",
          600: "#b8621a",
          700: "#8f4a14",
        },
        // 戦国ウォレット UIデザイン仕様 v1.0
        // CSS変数 (globals.css) を参照し、ダーク/ライト両テーマに対応する。
        // rgb(var(..) / <alpha-value>) 方式のため bg-sengoku-gold/10 等の
        // 透過度モディファイアもそのまま使える。
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
          // 白背景ボタンの文字色など、テーマに関わらず常に濃紺のまま固定したい箇所用
          ink: "rgb(var(--sengoku-ink) / <alpha-value>)",
        },
      },
      fontFamily: {
        heading: ["var(--font-noto-serif-jp)", "serif"],
        sans: ["var(--font-noto-sans-jp)", "sans-serif"],
      },
      borderRadius: {
        xl: "16px",
      },
    },
  },
  plugins: [],
};

export default config;
