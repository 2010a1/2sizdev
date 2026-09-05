/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Be Vietnam Pro"', "system-ui", "-apple-system", "Segoe UI", "sans-serif"]
      },
      colors: {
        /* Semantic tokens — single source of truth is the CSS variables in
           styles.css. Light/dark and accent themes flip the variables; these
           utilities follow automatically. Do not use raw palette utilities
           (bg-white, text-red-600, …) in components: they bypass theming and
           are what dark mode used to fight with !important overrides. */
        paper: "var(--paper)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        accent: {
          DEFAULT: "var(--accent)",
          strong: "var(--accent-strong)",
          soft: "var(--accent-soft)"
        },
        pass: {
          DEFAULT: "var(--pass)",
          soft: "var(--pass-soft)"
        },
        warn: {
          DEFAULT: "var(--warn)",
          soft: "var(--warn-soft)"
        },
        grade: {
          DEFAULT: "var(--grade)",
          soft: "var(--grade-soft)"
        },
        line: {
          DEFAULT: "var(--line)",
          strong: "var(--line-strong)",
          accent: "var(--line-accent)",
          pass: "var(--line-pass)",
          warn: "var(--line-warn)",
          grade: "var(--line-grade)"
        }
      }
    }
  },
  plugins: []
};
