import { useQuery } from "@tanstack/react-query";
import api from "../lib/api";
import { queryKeys } from "../lib/queryKeys";
import type {
  ApiResponse,
  LookupCategory,
  LookupOption,
  Metadata,
} from "../types";

const EMPTY: LookupOption[] = [];

/**
 * Fetches the DB-driven lookup metadata (statuses, types, roles, priorities,
 * ...) from GET /api/v1/metadata. This is the single source of truth for every
 * enum in the UI — dropdown options, labels, and badge colors all come from
 * here, never from hardcoded literals. Cached aggressively since lookups rarely
 * change within a session.
 */
export function useMetadata() {
  return useQuery({
    queryKey: queryKeys.metadata,
    queryFn: async (): Promise<Metadata> => {
      const res =
        await api.get<ApiResponse<{ lookups: Metadata }>>("/metadata");
      return res.data.lookups;
    },
    staleTime: 1000 * 60 * 60, // 1 hour
    gcTime: 1000 * 60 * 60 * 24,
  });
}

/**
 * Returns the options for a single lookup category, plus helpers to resolve a
 * value's display label and badge color from the DB-driven metadata.
 *
 * @example
 *   const { options, getLabel, getColor } = useLookup("jobStatus");
 */
export function useLookup(category: LookupCategory) {
  const { data, isLoading, isError } = useMetadata();
  const options = data?.[category] ?? EMPTY;

  const find = (value: string) => options.find((o) => o.value === value);

  return {
    options,
    isLoading,
    isError,
    /** Human-readable label for a value (falls back to the raw value). */
    getLabel: (value: string | null | undefined): string => {
      if (!value) return "—";
      return find(value)?.label ?? value;
    },
    /** Tailwind badge classes for a value (with a neutral fallback). */
    getColor: (value: string | null | undefined): string => {
      const fallback = "bg-gray-100 text-gray-800";
      if (!value) return fallback;
      return find(value)?.color ?? fallback;
    },
  };
}
