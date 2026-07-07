import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import toast, { Toaster } from "./lib/toast";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { queryClient, persister } from "./lib/queryClient";
import "./index.css";

// When a code-split chunk fails to load after a redeploy (its hashed filename no
// longer exists on the server), Vite emits `vite:preloadError`. Reload once to
// pull the fresh index.html + chunks instead of showing the error screen. The
// time-guard prevents an infinite reload loop if the failure is persistent.
window.addEventListener("vite:preloadError", () => {
  const key = "vitePreloadReloadAt";
  const last = Number(sessionStorage.getItem(key) ?? "0");
  if (Date.now() - last > 10_000) {
    sessionStorage.setItem(key, String(Date.now()));
    window.location.reload();
  }
});

// Registering the service worker ourselves (rather than the plugin's
// auto-injected script) lets us prompt the user to reload when a new build
// has been deployed. Without this, a browser tab can keep running an old
// cached bundle indefinitely — which looks like random, unreproducible bugs
// (stale JS handling new API responses, fixes that "don't take", etc.) until
// the user happens to fully close and reopen the app.
const updateSW = registerSW({
  onNeedRefresh() {
    toast(
      (t) => (
        <span className="flex items-center gap-3">
          <span>An update is available.</span>
          <button
            onClick={() => {
              toast.dismiss(t.id);
              void updateSW(true);
            }}
            className="font-semibold text-primary-600 underline underline-offset-2"
          >
            Reload
          </button>
        </span>
      ),
      { duration: Infinity, id: "sw-update" },
    );
  },
});

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("root element not found");

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: Infinity,
        // Persist only the offline mutation queue; offline reads come from the
        // service worker's runtime cache, not from persisted query data.
        dehydrateOptions: { shouldDehydrateQuery: () => false },
      }}
      onSuccess={() => {
        // Replay any queued offline mutations once the cache is restored.
        void queryClient.resumePausedMutations();
      }}
    >
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
        <Toaster position="top-right" />
      </BrowserRouter>
    </PersistQueryClientProvider>
  </React.StrictMode>,
);
