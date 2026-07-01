import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  eachDayOfInterval,
  parseISO,
  subDays,
  addDays,
  format,
} from "date-fns";
import api from "../lib/api";
import { socket } from "../lib/socket";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse, Technician, Job } from "../types";
import toast from "react-hot-toast";

/**
 * Subscribes the open dispatch board to live updates. The backend emits
 * `dispatch:*` events into per-date rooms whenever a job is assigned,
 * rescheduled, created, deleted, or has its status changed. We join a room for
 * every visible date (padded a day on each side to cover any UTC/local date
 * boundary) and invalidate the board query whenever such an event arrives, so a
 * change made by one dispatcher shows up for everyone without a manual refresh.
 */
export function useDispatchRealtime(fromStr: string, toStr: string) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!fromStr || !toStr) return;

    const dates = eachDayOfInterval({
      start: subDays(parseISO(fromStr), 1),
      end: addDays(parseISO(toStr), 1),
    }).map((d) => format(d, "yyyy-MM-dd"));

    dates.forEach((d) => socket.emit("join:dispatch", d));

    const handler = (event: string) => {
      if (typeof event === "string" && event.startsWith("dispatch:")) {
        void qc.invalidateQueries({ queryKey: ["dispatch"] });
        void qc.invalidateQueries({ queryKey: ["jobs"] });
      }
    };
    socket.onAny(handler);

    return () => {
      dates.forEach((d) => socket.emit("leave:dispatch", d));
      socket.offAny(handler);
    };
  }, [fromStr, toStr, qc]);
}

interface DispatchBoard {
  technicians: (Technician & { jobs: Job[] })[];
  unassigned: Job[];
  /** Jobs with no scheduled date (day-independent backlog). */
  undated: Job[];
}

export function useDispatchBoard(from: string, to: string) {
  return useQuery({
    queryKey: ["dispatch", from, to],
    queryFn: async () => {
      const res = await api.get<ApiResponse<DispatchBoard>>("/dispatch/board", {
        params: { from, to },
      });
      return res.data;
    },
    enabled: !!from && !!to,
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
      void qc.invalidateQueries({ queryKey: ["dispatch"] });
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
      void qc.invalidateQueries({ queryKey: ["dispatch"] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["job", vars.jobId] });
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to reschedule job"));
    },
  });
}

/**
 * Clears a job's scheduled date (moves it back to the undated backlog),
 * keeping any technician assignment.
 */
export function useUnscheduleJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId }: { jobId: string; date: string }) =>
      api.put<ApiResponse<Job>>(`/jobs/${jobId}`, {
        scheduledStart: null,
        scheduledEnd: null,
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["dispatch"] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["job", vars.jobId] });
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to move job to undated"));
    },
  });
}
