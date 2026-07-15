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
        sengoku: {
          bg: "#0E0E11",
          surface: "#0B0B0D",
          navy: "#0F1626",
          red: "#B3202A",
          gold: "#D4AF37",
          "gold-soft": "#F5E6B3",
          muted: "#BFBFBF",
          faint: "#7A7A7A",
          border: "#2A2A2E",
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
