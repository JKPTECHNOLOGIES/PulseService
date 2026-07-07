import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // "prompt" (not "autoUpdate"): main.tsx registers the SW with an
      // onNeedRefresh toast so a new deploy waits for the user to hit "Reload"
      // instead of reloading mid-task (which could drop an in-progress entry).
      registerType: "prompt",
      // We register the service worker ourselves (see main.tsx) so we can
      // prompt the user to reload when a new version is available, instead
      // of silently leaving an old cached bundle running until they happen
      // to close every tab. Disable the plugin's own auto-injected script.
      injectRegister: null,
      // Generates the icon set (192/512/maskable/apple-touch/favicon) from the
      // source SVG and injects the icon + theme-color tags into index.html.
      pwaAssets: { image: "public/logo.svg" },
      manifest: {
        name: "PulseService",
        short_name: "PulseService",
        description: "Field Service Management Platform",
        theme_color: "#2563eb",
        background_color: "#111827",
        display: "standalone",
        start_url: "/",
        scope: "/",
      },
      workbox: {
        // Pull in our custom push / notificationclick handlers.
        importScripts: ["push-sw.js"],
        // Precache the built app shell so the app opens with no connection.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/socket\.io/],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
        runtimeCaching: [
          // Attachment images rarely change — cache aggressively for offline
          // viewing and fast repeat loads.
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/api/v1/attachments") &&
              url.pathname.endsWith("/raw"),
            handler: "CacheFirst",
            options: {
              cacheName: "pulse-attachments",
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // DB-driven lookups: serve instantly, refresh in the background.
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/api/v1/metadata"),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "pulse-metadata" },
          },
          // All other data: live when online, last-known snapshot when offline.
          // Auth is never cached.
          {
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/api/v1") &&
              !url.pathname.startsWith("/api/v1/auth"),
            handler: "NetworkFirst",
            options: {
              cacheName: "pulse-api",
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      // Service worker only in production builds (served by nginx), not vite dev.
      devOptions: { enabled: false },
    }),
  ],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:5000",
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Peel heavy, independently-cacheable vendors into their own chunks so
        // the main bundle stays small and charts/drag-and-drop only load on the
        // pages that use them.
        manualChunks: {
          "react-vendor": ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
          dnd: ["@dnd-kit/core", "@dnd-kit/sortable", "@dnd-kit/utilities"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
});
