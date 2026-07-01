import { useCallback, useState } from "react";

export interface SavedView<T> {
  id: string;
  name: string;
  state: T;
}

function storageKey(tableId: string) {
  return `pulse.savedViews.${tableId}`;
}

function load<T>(tableId: string): SavedView<T>[] {
  try {
    const raw = localStorage.getItem(storageKey(tableId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedView<T>[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Persists named "views" (an arbitrary filter/sort state object) for a table in
 * localStorage, so users can save and re-apply their preferred configurations.
 */
export function useSavedViews<T>(tableId: string) {
  const [views, setViews] = useState<SavedView<T>[]>(() => load<T>(tableId));

  const persist = useCallback(
    (next: SavedView<T>[]) => {
      setViews(next);
      try {
        localStorage.setItem(storageKey(tableId), JSON.stringify(next));
      } catch {
        // Ignore quota / serialization errors — saved views are best-effort.
      }
    },
    [tableId],
  );

  const saveView = useCallback(
    (name: string, state: T) => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : String(Date.now());
      persist([...views, { id, name, state }]);
    },
    [views, persist],
  );

  const deleteView = useCallback(
    (id: string) => {
      persist(views.filter((v) => v.id !== id));
    },
    [views, persist],
  );

  return { views, saveView, deleteView };
}
