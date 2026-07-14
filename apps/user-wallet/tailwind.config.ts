import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fef6ea",
          500: "#d9822b",
          600: "#b8621a",
          700: "#8f4a14",
        },
      },
    },
  },
  plugins: [],
};

export default config;
