import { useCallback } from "react";

const STORAGE_KEY = "pulse-help-seen";

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function writeSeen(seen: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(seen)));
  } catch {
    // Storage disabled/unavailable (e.g. private browsing) — onboarding will
    // just re-show next time, which is an acceptable fallback.
  }
}

/**
 * Clears every "seen" page-help entry, so first-visit onboarding pops up
 * again as the user revisits each page. Used by the Settings "replay page
 * tours" action.
 */
export function resetAllPageHelpSeen() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore — nothing to clear if storage isn't available anyway.
  }
}

/**
 * Tracks which page-help entries (by their stable `PageHelpContent.key`) the
 * current browser has already seen, persisted in localStorage so first-time
 * onboarding only pops up once per page, ever, on this device.
 */
export function usePageHelpSeen() {
  const hasSeen = useCallback((key: string) => readSeen().has(key), []);

  const markSeen = useCallback((key: string) => {
    const seen = readSeen();
    if (seen.has(key)) return;
    seen.add(key);
    writeSeen(seen);
  }, []);

  return { hasSeen, markSeen };
}
