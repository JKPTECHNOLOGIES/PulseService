import { QueryClient } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { registerOfflineMutations } from "./offlineMutations";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30000,
    },
  },
});

// Default mutation functions for offline-capable actions (see offlineMutations).
registerOfflineMutations(queryClient);

const PERSIST_KEY = "pulse-offline-cache";

// Persists the query client to localStorage. We only dehydrate the *mutation*
// queue (see main.tsx) — the service worker already caches API responses for
// offline reads, so we avoid duplicating (and bloating) query data here.
export const persister = createAsyncStoragePersister({
  storage: window.localStorage,
  key: PERSIST_KEY,
});

/**
 * Wipes cached data, the persisted offline queue, and the service worker's API
 * caches. Called on logout so one account never sees another's cached data.
 */
export async function clearOfflineData(): Promise<void> {
  queryClient.clear();
  try {
    window.localStorage.removeItem(PERSIST_KEY);
  } catch {
    /* ignore storage errors */
  }
  if ("caches" in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("pulse-")).map((k) => caches.delete(k)),
      );
    } catch {
      /* ignore cache errors */
    }
  }
}
