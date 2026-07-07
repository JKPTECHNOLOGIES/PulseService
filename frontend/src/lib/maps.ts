import { isApplePlatform } from "../utils/phone";

export interface DirectionsTarget {
  lat?: number | null;
  lng?: number | null;
  /** Address fragments, joined and used when lat/lng aren't available. */
  address?: (string | null | undefined)[];
}

/**
 * The single source of truth for "navigate here" links across the app (Job
 * Detail, My Day, the Map). Prefers exact coordinates, falls back to a joined
 * address, and opens the platform's native Maps app — Apple Maps on iOS/macOS,
 * Google Maps everywhere else — with no API key. Returns null when there's
 * nothing to route to.
 */
export function directionsUrl(target: DirectionsTarget): string | null {
  const dest =
    target.lat != null && target.lng != null
      ? `${String(target.lat)},${String(target.lng)}`
      : (target.address ?? []).filter(Boolean).join(", ");
  if (!dest) return null;
  const d = encodeURIComponent(dest);
  return isApplePlatform()
    ? `https://maps.apple.com/?daddr=${d}`
    : `https://www.google.com/maps/dir/?api=1&destination=${d}`;
}
