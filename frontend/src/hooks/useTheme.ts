import { useSyncExternalStore, useCallback } from "react";

export type ThemePref = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

function readStored(): ThemePref {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" || v === "system" ? v : "system";
}

function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(pref: ThemePref): boolean {
  return pref === "dark" || (pref === "system" && systemPrefersDark());
}

/**
 * Applies (or removes) the `dark` class on <html>. Exported so the pre-React
 * inline script and the hook share one source of truth for the toggle behavior.
 */
export function applyTheme(pref: ThemePref): void {
  document.documentElement.classList.toggle("dark", resolve(pref));
}

// A tiny external store so every component that reads the theme stays in sync,
// and so a `system` preference reacts to the OS switching light/dark live.
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => {
    l();
  });
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystem = () => {
    if (readStored() === "system") {
      applyTheme("system");
      cb();
    }
  };
  mq.addEventListener("change", onSystem);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", onSystem);
  };
}

export function useTheme() {
  const pref = useSyncExternalStore(
    subscribe,
    readStored,
    (): ThemePref => "system",
  );

  const setTheme = useCallback((next: ThemePref) => {
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
    emit();
  }, []);

  const isDark = resolve(pref);

  const toggle = useCallback(() => {
    // Toggle jumps to the explicit opposite of what's currently showing.
    setTheme(resolve(readStored()) ? "light" : "dark");
  }, [setTheme]);

  return { pref, isDark, setTheme, toggle };
}
