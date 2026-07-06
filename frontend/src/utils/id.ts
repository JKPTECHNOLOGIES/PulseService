/**
 * Generates a unique-enough client-side id, for React keys / draft-item
 * tracking that never gets sent to the server (a real UUID isn't required,
 * just uniqueness within the current session).
 *
 * `crypto.randomUUID()` only exists in a "secure context" (HTTPS or
 * `localhost`) — calling it directly throws `crypto.randomUUID is not a
 * function` on a plain-HTTP address (e.g. a LAN IP during testing, or a
 * fresh deploy before its SSL cert is in place). Falls back to a
 * timestamp + counter when it's unavailable.
 */
let counter = 0;

export function generateId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  counter += 1;
  return `id-${Date.now().toString(36)}-${counter.toString(36)}`;
}
