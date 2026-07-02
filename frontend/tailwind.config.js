/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  // Manual (class-based) dark mode: a `dark` class on <html> flips the neutral
  // palette below. Themes are driven entirely by CSS variables, so existing
  // bg-white / bg-gray-* / text-gray-* / border-gray-* classes adapt with no
  // per-component changes.
  darkMode: "class",
  // Dispatch cards derive a solid color from the DB status badge color
  // (bg-<hue>-500). Those classes are built dynamically, so safelist them.
  safelist: [
    "bg-blue-500",
    "bg-indigo-500",
    "bg-purple-500",
    "bg-violet-500",
    "bg-yellow-500",
    "bg-amber-500",
    "bg-orange-500",
    "bg-green-500",
    "bg-emerald-500",
    "bg-teal-500",
    "bg-cyan-500",
    "bg-red-500",
    "bg-rose-500",
    "bg-pink-500",
    "bg-gray-500",
    "bg-slate-500",
  ],
  theme: {
    extend: {
      // Safe-area inset spacing (notch / home indicator). Usable as e.g.
      // pt-safe-top, pb-safe-bottom, px utilities via safe-left/right.
      spacing: {
        "safe-top": "env(safe-area-inset-top)",
        "safe-bottom": "env(safe-area-inset-bottom)",
        "safe-left": "env(safe-area-inset-left)",
        "safe-right": "env(safe-area-inset-right)",
      },
      colors: {
        // Neutral surfaces/text resolve to CSS variables (defined in index.css)
        // that invert under `.dark`. `oncolor` is a fixed white for text/icons
        // that sit on a colored or dark surface and must NOT flip.
        white: "rgb(var(--c-white) / <alpha-value>)",
        oncolor: "#ffffff",
        gray: {
          50: "rgb(var(--c-gray-50) / <alpha-value>)",
          100: "rgb(var(--c-gray-100) / <alpha-value>)",
          200: "rgb(var(--c-gray-200) / <alpha-value>)",
          300: "rgb(var(--c-gray-300) / <alpha-value>)",
          400: "rgb(var(--c-gray-400) / <alpha-value>)",
          500: "rgb(var(--c-gray-500) / <alpha-value>)",
          600: "rgb(var(--c-gray-600) / <alpha-value>)",
          700: "rgb(var(--c-gray-700) / <alpha-value>)",
          800: "rgb(var(--c-gray-800) / <alpha-value>)",
          900: "rgb(var(--c-gray-900) / <alpha-value>)",
          950: "rgb(var(--c-gray-950) / <alpha-value>)",
        },
        primary: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#172554",
        },
      },
    },
  },
  plugins: [],
};
