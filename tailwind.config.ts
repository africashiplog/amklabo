import type { Config } from "tailwindcss";

// Palette extraite du logo officiel AMKLABO.
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6fc",
          100: "#d6e9f7",
          200: "#a9d0ee",
          500: "#057bc0",
          600: "#026fb3",
          700: "#03589a",
          800: "#034581",
          900: "#03345f",
        },
        leaf: {
          50: "#f0f8ec",
          100: "#dcefd3",
          500: "#4c9833",
          600: "#448833",
          700: "#376e29",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
