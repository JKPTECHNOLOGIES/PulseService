import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse, Technician, Job } from "../types";
import toast from "react-hot-toast";

interface DispatchBoard {
  technicians: (Technician & { jobs: Job[] })[];
  unassigned: Job[];
}

export function useDispatchBoard(date: string) {
  return useQuery({
    queryKey: ["dispatch", date],
    queryFn: async () => {
      const res = await api.get<ApiResponse<DispatchBoard>>("/dispatch/board", {
        params: { date },
      });
      return res.data;
    },
    enabled: !!date,
  });
}

interface ReassignVars {
  jobId: string;
  /** Technician to remove the job from (omit/null when the job is unassigned). */
  fromTechnicianId?: string | null;
  /** Technician to assign the job to (omit/null to unassign). */
  toTechnicianId?: string | null;
  /** Board date, used only for cache invalidation. */
  date: string;
}

/**
 * Moves a job between technicians (or assigns/unassigns it) via the dispatch
 * endpoint, which removes the job from `fromTechnicianId` and/or assigns it to
 * `toTechnicianId`. This avoids the old bug where reassigning only ADDED a
 * technician, leaving the job duplicated across rows.
 */
export function useReassignDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, fromTechnicianId, toTechnicianId }: ReassignVars) =>
      api.post<ApiResponse<Job>>("/dispatch/reassign", {
        jobId,
        fromTechnicianId: fromTechnicianId ?? undefined,
        toTechnicianId: toTechnicianId ?? undefined,
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["dispatch", vars.date] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["job", vars.jobId] });
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update assignment"));
    },
  });
}
