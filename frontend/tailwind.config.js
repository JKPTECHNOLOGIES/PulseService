/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
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
