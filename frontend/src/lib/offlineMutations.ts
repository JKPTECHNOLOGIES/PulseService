import type { QueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import api from "./api";
import { getErrorMessage } from "./errors";
import type { ApiResponse } from "../types";

// Field actions that must survive going offline — and even an app reload.
// Their mutation functions are registered as *defaults* keyed by mutationKey so
// the persisted offline queue can replay them once connectivity returns (a
// paused mutation only stores its variables + key, never the function itself).
export const OFFLINE_MK = {
  clockIn: ["offline", "clock-in"] as const,
  clockOut: ["offline", "clock-out"] as const,
  issueToJob: ["offline", "issue-to-job"] as const,
  updateJobStatus: ["offline", "update-job-status"] as const,
};

export interface ClockInVars {
  jobId?: string;
}

export interface IssueToJobVars {
  jobId: string;
  inventoryItemId: string;
  stockLocationId: string;
  quantity: number;
  notes?: string;
}

export interface UpdateJobStatusVars {
  id: string;
  status: string;
  notes?: string;
}

export function registerOfflineMutations(qc: QueryClient) {
  qc.setMutationDefaults(OFFLINE_MK.clockIn, {
    mutationFn: (vars: ClockInVars) =>
      api.post<ApiResponse<unknown>>("/time/clock-in", vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["time"] });
      toast.success("Clocked in");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to clock in"));
    },
  });

  qc.setMutationDefaults(OFFLINE_MK.clockOut, {
    mutationFn: () => api.post<ApiResponse<unknown>>("/time/clock-out"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["time"] });
      toast.success("Clocked out");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to clock out"));
    },
  });

  qc.setMutationDefaults(OFFLINE_MK.issueToJob, {
    mutationFn: (vars: IssueToJobVars) =>
      api.post<ApiResponse<unknown>>("/inventory/issue", vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Part issued to job");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to issue part"));
    },
  });

  qc.setMutationDefaults(OFFLINE_MK.updateJobStatus, {
    mutationFn: (vars: UpdateJobStatusVars) =>
      api.patch<ApiResponse<unknown>>(`/jobs/${vars.id}/status`, {
        status: vars.status,
        notes: vars.notes,
      }),
    onSuccess: (_data, vars: UpdateJobStatusVars) => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["job", vars.id] });
      void qc.invalidateQueries({ queryKey: ["dispatch"] });
      toast.success("Job status updated");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update status"));
    },
  });
}
