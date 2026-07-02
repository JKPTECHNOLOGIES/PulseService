import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Standalone test config so the app's vite.config.ts (PWA/build) stays focused.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
