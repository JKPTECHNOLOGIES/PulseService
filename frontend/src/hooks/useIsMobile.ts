import { useEffect, useState } from "react";

/**
 * Tracks whether the viewport matches a media query (defaults to Tailwind's
 * `< sm` breakpoint). Used to render one layout at a time (e.g. cards vs. table)
 * instead of shipping both to the DOM.
 */
export function useIsMobile(query = "(max-width: 639px)"): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => {
      setMatches(e.matches);
    };
    setMatches(mql.matches);
    mql.addEventListener("change", handler);
    return () => {
      mql.removeEventListener("change", handler);
    };
  }, [query]);

  return matches;
}
