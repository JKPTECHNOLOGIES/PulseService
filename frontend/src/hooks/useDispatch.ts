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
import type { ApiResponse, Technician, Job, JobTechnician } from "../types";
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

// ---------------------------------------------------------------------------
// Optimistic board updates
//
// Every drag mutation snapshots the cached board(s), applies the expected
// result immediately so the card moves under the cursor without waiting for the
// round-trip, then reconciles against the server on settle (and rolls back on
// error). The apply* helpers below are pure functions over a DispatchBoard.
// ---------------------------------------------------------------------------

type BoardTech = Technician & { jobs: Job[] };

// Remove a job from every bucket, returning the removed job (if present) and
// the pruned board. A job lives in exactly one bucket, so this is unambiguous.
function extractJob(
  board: DispatchBoard,
  jobId: string,
): { job: Job | null; board: DispatchBoard } {
  let found: Job | null = null;
  const take = (jobs: Job[]): Job[] =>
    jobs.filter((j) => {
      if (j.id === jobId) {
        found = j;
        return false;
      }
      return true;
    });
  const technicians = board.technicians.map((t) => ({
    ...t,
    jobs: take(t.jobs),
  }));
  const unassigned = take(board.unassigned);
  const undated = take(board.undated);
  return { job: found, board: { technicians, unassigned, undated } };
}

function applyReassign(
  board: DispatchBoard,
  jobId: string,
  toTechnicianId: string | null,
): DispatchBoard {
  const { job, board: pruned } = extractJob(board, jobId);
  if (!job) return board;

  const targetTech: BoardTech | undefined = toTechnicianId
    ? board.technicians.find((t) => t.id === toTechnicianId)
    : undefined;

  // Rebuild the assignment so the card shows the new lead tech immediately.
  const technicians: JobTechnician[] =
    toTechnicianId && targetTech
      ? [
          {
            id: `optimistic-${jobId}`,
            jobId,
            technicianId: toTechnicianId,
            isLead: true,
            status: "assigned",
            technician: {
              id: targetTech.id,
              userId: targetTech.userId,
              employeeId: targetTech.employeeId,
              skills: targetTech.skills,
              isAvailable: targetTech.isAvailable,
              user: targetTech.user,
            },
          },
        ]
      : [];
  const moved: Job = { ...job, technicians };

  // Undated jobs stay in the backlog — assigning a tech doesn't schedule them.
  if (!moved.scheduledStart) {
    return { ...pruned, undated: [...pruned.undated, moved] };
  }
  if (toTechnicianId && targetTech) {
    return {
      ...pruned,
      technicians: pruned.technicians.map((t) =>
        t.id === toTechnicianId ? { ...t, jobs: [...t.jobs, moved] } : t,
      ),
    };
  }
  return { ...pruned, unassigned: [...pruned.unassigned, moved] };
}

function applyReschedule(
  board: DispatchBoard,
  jobId: string,
  scheduledStart: string | null,
  scheduledEnd: string | null,
): DispatchBoard {
  const patch = (j: Job): Job =>
    j.id === jobId
      ? {
          ...j,
          scheduledStart: scheduledStart ?? undefined,
          scheduledEnd: scheduledEnd ?? undefined,
        }
      : j;
  return {
    technicians: board.technicians.map((t) => ({
      ...t,
      jobs: t.jobs.map(patch),
    })),
    unassigned: board.unassigned.map(patch),
    undated: board.undated.map(patch),
  };
}

function applyUnschedule(board: DispatchBoard, jobId: string): DispatchBoard {
  const { job, board: pruned } = extractJob(board, jobId);
  if (!job) return board;
  const moved: Job = {
    ...job,
    scheduledStart: undefined,
    scheduledEnd: undefined,
  };
  return { ...pruned, undated: [...pruned.undated, moved] };
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
    onMutate: async (vars: ReassignVars) => {
      await qc.cancelQueries({ queryKey: ["dispatch"] });
      const snapshots = qc.getQueriesData<DispatchBoard>({
        queryKey: ["dispatch"],
      });
      qc.setQueriesData<DispatchBoard>({ queryKey: ["dispatch"] }, (old) =>
        old ? applyReassign(old, vars.jobId, vars.toTechnicianId ?? null) : old,
      );
      return { snapshots };
    },
    onError: (err: unknown, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
      toast.error(getErrorMessage(err, "Failed to update assignment"));
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: ["dispatch"] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["job", vars.jobId] });
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
    onMutate: async (vars: RescheduleVars) => {
      await qc.cancelQueries({ queryKey: ["dispatch"] });
      const snapshots = qc.getQueriesData<DispatchBoard>({
        queryKey: ["dispatch"],
      });
      qc.setQueriesData<DispatchBoard>({ queryKey: ["dispatch"] }, (old) =>
        old
          ? applyReschedule(
              old,
              vars.jobId,
              vars.scheduledStart,
              vars.scheduledEnd,
            )
          : old,
      );
      return { snapshots };
    },
    onError: (err: unknown, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
      toast.error(getErrorMessage(err, "Failed to reschedule job"));
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: ["dispatch"] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["job", vars.jobId] });
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
    onMutate: async (vars: { jobId: string; date: string }) => {
      await qc.cancelQueries({ queryKey: ["dispatch"] });
      const snapshots = qc.getQueriesData<DispatchBoard>({
        queryKey: ["dispatch"],
      });
      qc.setQueriesData<DispatchBoard>({ queryKey: ["dispatch"] }, (old) =>
        old ? applyUnschedule(old, vars.jobId) : old,
      );
      return { snapshots };
    },
    onError: (err: unknown, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => {
        qc.setQueryData(key, data);
      });
      toast.error(getErrorMessage(err, "Failed to move job to undated"));
    },
    onSettled: (_data, _err, vars) => {
      void qc.invalidateQueries({ queryKey: ["dispatch"] });
      void qc.invalidateQueries({ queryKey: ["jobs"] });
      void qc.invalidateQueries({ queryKey: ["job", vars.jobId] });
    },
  });
}
