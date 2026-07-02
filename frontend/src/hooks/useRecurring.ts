import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse } from "../types";
import toast from "react-hot-toast";

export interface RecurringJob {
  id: string;
  customerId: string;
  locationId?: string | null;
  summary: string;
  description?: string | null;
  type: string;
  priority: string;
  frequency: string;
  interval: number;
  nextRunDate: string;
  isActive: boolean;
  lastRunAt?: string | null;
  createdAt: string;
  customer?: {
    id: string;
    firstName: string;
    lastName: string;
    companyName?: string | null;
  } | null;
}

export function useRecurringJobs() {
  return useQuery({
    queryKey: ["recurring"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<RecurringJob[]>>("/recurring");
      return res.data;
    },
  });
}

export function useCreateRecurringJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<RecurringJob>) =>
      api.post<ApiResponse<RecurringJob>>("/recurring", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recurring"] });
      toast.success("Recurring job created");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to create recurring job"));
    },
  });
}

export function useUpdateRecurringJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<RecurringJob> & { id: string }) =>
      api.put<ApiResponse<RecurringJob>>(`/recurring/${id}`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recurring"] });
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update recurring job"));
    },
  });
}

export function useDeleteRecurringJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<ApiResponse<null>>(`/recurring/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recurring"] });
      toast.success("Recurring job deleted");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to delete recurring job"));
    },
  });
}

export function useGenerateRecurringJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<ApiResponse<unknown>>(`/recurring/${id}/generate`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["recurring"] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["dispatch"] });
      toast.success("Job generated");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to generate job"));
    },
  });
}

export function useRunDueRecurringJobs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<ApiResponse<{ created: number }>>("/recurring/run-due"),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["recurring"] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["dispatch"] });
      toast.success(`Generated ${String(res.data.created)} job(s)`);
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to run due jobs"));
    },
  });
}
