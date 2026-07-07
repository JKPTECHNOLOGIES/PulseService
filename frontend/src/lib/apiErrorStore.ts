// Records the most recent API failure so the error toast can attach request
// diagnostics (endpoint, status) to whatever message it shows, making a copied
// report actually useful for debugging.
export interface ApiErrorInfo {
  method?: string;
  url?: string;
  status?: number;
  serverMessage?: string;
  at: number;
}

let last: ApiErrorInfo | null = null;

export function recordApiError(info: Omit<ApiErrorInfo, "at">): void {
  last = { ...info, at: Date.now() };
}

/** The last API error, if it happened within `maxAgeMs` (else null). */
export function takeRecentApiError(maxAgeMs = 4000): ApiErrorInfo | null {
  if (last && Date.now() - last.at <= maxAgeMs) return last;
  return null;
}
