// Small shared helpers for keyboard-shortcut UX.

// True on macOS/iOS, where ⌘ is the platform modifier instead of Ctrl.
export const IS_MAC =
  typeof navigator !== "undefined" &&
  /mac|iphone|ipad|ipod/i.test(navigator.userAgent);

// Label to show in shortcut hints (e.g. "⌘ K" vs "Ctrl K").
export const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";

// Whether a keydown originated from a field the user is actively typing in, so
// single-key shortcuts (n, /, ?) don't hijack normal text entry.
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
}
