import { useQuery } from "@tanstack/react-query";
import api from "../lib/api";
import type { ApiResponse, Job } from "../types";

/**
 * The logged-in technician's assigned jobs for a given day (YYYY-MM-DD),
 * ordered by scheduled start. Returns an empty list for non-technician users.
 */
export function useMyDay(date: string) {
  return useQuery({
    queryKey: ["myday", date],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Job[]>>("/technicians/me/jobs", {
        params: { date },
      });
      return res.data;
    },
  });
}
