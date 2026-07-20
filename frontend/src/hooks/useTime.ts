import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import { OFFLINE_MK, type ClockInVars } from "../lib/offlineMutations";
import type { ApiResponse } from "../types";
import toast from "../lib/toast";

export interface TimeEntry {
  id: string;
  userId: string;
  technicianId?: string | null;
  jobId?: string | null;
  type: string;
  startTime: string;
  endTime?: string | null;
  duration?: number | null;
  notes?: string | null;
  job?: { id: string; jobNumber: string; summary: string } | null;
  user?: { firstName: string; lastName: string } | null;
}

export function useCurrentTimeEntry() {
  return useQuery({
    queryKey: ["time", "current"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<TimeEntry | null>>("/time/current");
      return res.data;
    },
  });
}

export function useJobTimeEntries(jobId: string) {
  return useQuery({
    queryKey: ["time", "job", jobId],
    queryFn: async () => {
      const res = await api.get<ApiResponse<TimeEntry[]>>(`/time/job/${jobId}`);
      return res.data;
    },
    enabled: !!jobId,
  });
}

// Clock in/out carry a `mutationKey` matching the offline defaults registered in
// lib/offlineMutations. Live calls use the inline fn below; if a call is made
// offline and the app is reloaded before reconnecting, the persisted queue
// replays it via the keyed default. Either way it syncs when back online.
export function useClockIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: OFFLINE_MK.clockIn,
    mutationFn: (vars: ClockInVars) =>
      api.post<ApiResponse<TimeEntry>>("/time/clock-in", vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["time"] });
      toast.success("Clocked in");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to clock in"));
    },
  });
}

export function useClockOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: OFFLINE_MK.clockOut,
    mutationFn: () => api.post<ApiResponse<TimeEntry>>("/time/clock-out"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["time"] });
      toast.success("Clocked out");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to clock out"));
    },
  });
}

export interface TimeEntryInput {
  technicianId: string;
  jobId?: string;
  startTime: string;
  endTime?: string | null;
  notes?: string;
}

// Admin-only (time.manage): manually add a time entry on a technician's
// behalf, e.g. hours forgotten in the field or backfilled from a timesheet.
export function useCreateTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: TimeEntryInput) =>
      api.post<ApiResponse<TimeEntry>>("/time", vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["time"] });
      toast.success("Time entry added");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to add time entry"));
    },
  });
}

// Admin-only (time.manage): edit an existing entry's technician, times, or
// notes.
export function useUpdateTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...vars
    }: Partial<TimeEntryInput> & { id: string }) =>
      api.put<ApiResponse<TimeEntry>>(`/time/${id}`, vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["time"] });
      toast.success("Time entry updated");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update time entry"));
    },
  });
}

// Admin-only (time.manage): remove an incorrect or duplicate entry.
export function useDeleteTimeEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<ApiResponse<null>>(`/time/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["time"] });
      toast.success("Time entry removed");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to remove time entry"));
    },
  });
}
