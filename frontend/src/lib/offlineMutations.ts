import type { QueryClient } from "@tanstack/react-query";
import toast from "./toast";
import api from "./api";
import { getErrorMessage } from "./errors";
import type { ApiResponse, Job } from "../types";

// Field actions that must survive going offline — and even an app reload.
// Their mutation functions are registered as *defaults* keyed by mutationKey so
// the persisted offline queue can replay them once connectivity returns (a
// paused mutation only stores its variables + key, never the function itself).
export const OFFLINE_MK = {
  clockIn: ["offline", "clock-in"] as const,
  clockOut: ["offline", "clock-out"] as const,
  issueToJob: ["offline", "issue-to-job"] as const,
  updateJobStatus: ["offline", "update-job-status"] as const,
  installSerializedUnit: ["offline", "install-serialized-unit"] as const,
  uninstallSerializedUnit: ["offline", "uninstall-serialized-unit"] as const,
  reverseTransaction: ["offline", "reverse-transaction"] as const,
  updateJob: ["offline", "update-job"] as const,
  createJob: ["offline", "create-job"] as const,
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

export interface InstallSerializedUnitVars {
  id: string;
  installedCustomerId?: string;
  installedLocationId?: string;
  installedJobId?: string;
  equipmentId?: string;
  warrantyExpiresAt?: string;
}

export interface ReverseTransactionVars {
  id: string;
  reason?: string;
}

export type UpdateJobVars = Partial<Job> & {
  id: string;
  expectedUpdatedAt?: string;
};

export type CreateJobVars = Partial<Job>;

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

  qc.setMutationDefaults(OFFLINE_MK.installSerializedUnit, {
    mutationFn: ({ id, ...payload }: InstallSerializedUnitVars) =>
      api.post<ApiResponse<unknown>>(`/serials/${id}/install`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["serials"] });
      toast.success("Unit marked installed");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to install unit"));
    },
  });

  qc.setMutationDefaults(OFFLINE_MK.uninstallSerializedUnit, {
    mutationFn: (id: string) =>
      api.post<ApiResponse<unknown>>(`/serials/${id}/uninstall`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["serials"] });
      toast.success("Unit removed from job");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to remove unit"));
    },
  });

  qc.setMutationDefaults(OFFLINE_MK.reverseTransaction, {
    mutationFn: ({ id, reason }: ReverseTransactionVars) =>
      api.post<ApiResponse<unknown>>(`/inventory/transactions/${id}/reverse`, {
        reason,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Movement reversed");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to reverse movement"));
    },
  });

  qc.setMutationDefaults(OFFLINE_MK.updateJob, {
    mutationFn: ({ id, expectedUpdatedAt, ...payload }: UpdateJobVars) =>
      api.put<ApiResponse<Job>>(`/jobs/${id}`, {
        ...payload,
        expectedUpdatedAt,
      }),
    onSuccess: (_data, vars: UpdateJobVars) => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["job", vars.id] });
      void qc.invalidateQueries({ queryKey: ["dispatch"] });
      toast.success("Job updated successfully");
    },
    onError: (err: unknown, vars: UpdateJobVars) => {
      // On a stale-job conflict (409 -- someone else edited it while this was
      // queued), refetch so the office/tech sees the real current state
      // instead of the queued edit looking like it silently vanished.
      void qc.invalidateQueries({ queryKey: ["job", vars.id] });
      toast.error(getErrorMessage(err, "Failed to update job"));
    },
  });

  qc.setMutationDefaults(OFFLINE_MK.createJob, {
    mutationFn: (payload: CreateJobVars) =>
      api.post<ApiResponse<Job>>("/jobs", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["dispatch"] });
      toast.success("Job created successfully");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to create job"));
    },
  });
}
