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
};

export interface ClockInVars {
  jobId?: string;
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
}
