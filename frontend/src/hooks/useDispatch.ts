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
  /** Technician to assign the job to (omit/null to unassign). */
  toTechnicianId?: string | null;
  /** Board date, used only for cache invalidation. */
  date: string;
}

/**
 * Assigns a job to exactly one technician, or unassigns it (toTechnicianId
 * null). The backend clears all existing assignments first, so a job never
 * ends up duplicated across technician rows.
 */
export function useReassignDispatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, toTechnicianId }: ReassignVars) =>
      api.post<ApiResponse<Job>>("/dispatch/reassign", {
        jobId,
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

interface RescheduleVars {
  jobId: string;
  scheduledStart: string;
  scheduledEnd: string;
  /** Board date, used only for cache invalidation. */
  date: string;
}

/** Updates a job's scheduled start/end (used when dragging a job along the
 * dispatch timeline to a new time). */
export function useRescheduleJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, scheduledStart, scheduledEnd }: RescheduleVars) =>
      api.put<ApiResponse<Job>>(`/jobs/${jobId}`, {
        scheduledStart,
        scheduledEnd,
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["dispatch", vars.date] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["job", vars.jobId] });
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to reschedule job"));
    },
  });
}
