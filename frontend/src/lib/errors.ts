/**
 * Extracts a human-readable message from an unknown error. The API rejects with
 * its JSON body (`{ success: false, error: "..." }`), so we prefer `.error`,
 * then `.message`, then a caller-supplied fallback. Centralizing this removes
 * the `(err: any) => err?.message` pattern from every mutation handler.
 */
export function getErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (typeof err === "object" && err !== null) {
    const e = err as { error?: unknown; message?: unknown };
    if (typeof e.error === "string" && e.error) return e.error;
    if (typeof e.message === "string" && e.message) return e.message;
  }
  return fallback;
}
