import { useCallback, useEffect, useRef, useState } from "react";

interface UseFormDraftOptions<T> {
  /** localStorage key, unique per form (e.g. "draft:invoice:new"). */
  key: string;
  /** Only draft when true (typically !isEditing — we don't draft edits). */
  enabled: boolean;
  /** The current serializable snapshot of the form to persist. */
  value: T;
  /** Whether the snapshot is worth saving (so we don't persist an empty form). */
  hasContent: (value: T) => boolean;
  /** Apply a restored snapshot back onto the form. Runs once on mount. */
  onRestore: (value: T) => void;
}

/**
 * Persists an in-progress form to localStorage as it changes and restores it
 * when the form is reopened, so navigating away by accident (or a reload) never
 * wipes work. Returns whether a draft was restored, plus a `clearDraft` to call
 * on successful submit or when the user chooses to start fresh.
 */
export function useFormDraft<T>({
  key,
  enabled,
  value,
  hasContent,
  onRestore,
}: UseFormDraftOptions<T>): { restored: boolean; clearDraft: () => void } {
  const [restored, setRestored] = useState(false);

  // Keep onRestore in a ref so the restore effect can run exactly once without
  // re-firing when the callback's identity changes each render.
  const onRestoreRef = useRef(onRestore);
  useEffect(() => {
    onRestoreRef.current = onRestore;
  });

  useEffect(() => {
    if (!enabled) return;
    const raw = localStorage.getItem(key);
    if (!raw) return;
    try {
      onRestoreRef.current(JSON.parse(raw) as T);
      setRestored(true);
    } catch {
      localStorage.removeItem(key);
    }
  }, [key, enabled]);

  useEffect(() => {
    if (!enabled || !hasContent(value)) return;
    const t = setTimeout(() => {
      localStorage.setItem(key, JSON.stringify(value));
    }, 500);
    return () => {
      clearTimeout(t);
    };
  }, [key, enabled, value, hasContent]);

  const clearDraft = useCallback(() => {
    localStorage.removeItem(key);
    setRestored(false);
  }, [key]);

  return { restored, clearDraft };
}
