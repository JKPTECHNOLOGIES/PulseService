import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { Toaster } from "react-hot-toast";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { queryClient, persister } from "./lib/queryClient";
import "./index.css";

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
