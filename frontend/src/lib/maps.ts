/**
 * Build a Google Maps *directions* URL for an address. Opens turn-by-turn
 * navigation in the browser or the native Maps app on a phone — no API key
 * needed. Falls back gracefully if some address parts are missing.
 */
export function directionsUrl(parts: (string | null | undefined)[]): string {
  const destination = parts.filter(Boolean).join(", ");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    destination,
  )}`;
}
