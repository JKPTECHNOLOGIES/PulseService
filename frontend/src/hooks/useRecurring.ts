import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse } from "../types";
import toast from "../lib/toast";

export interface RecurringJob {
  id: string;
  customerId: string;
  locationId?: string | null;
  // Optional link to the ServiceAgreement this schedule fulfills (the labor
  // side -- see useAgreements for the separate billing/invoice side).
  agreementId?: string | null;
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
  agreement?: { id: string; agreementNumber: string; name: string } | null;
  // Count of jobs (work orders) this template has generated so far -- the
  // labor side of a recurring arrangement (see useAgreements for the
  // separate billing/invoice side).
  _count?: { jobs: number };
}

// Frequency vocabulary is specific to RecurringJob (not DB-driven, unlike
// ServiceAgreement.billingFrequency) -- shared here so every page that shows
// a frequency label stays in sync.
export const RECURRING_FREQUENCIES = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
];

export const recurringFreqLabel = (v: string): string =>
  RECURRING_FREQUENCIES.find((f) => f.value === v)?.label ?? v;

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
