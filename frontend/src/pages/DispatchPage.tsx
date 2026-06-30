import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { format, addDays, subDays, parseISO } from "date-fns";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CalendarDaysIcon,
  XMarkIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  useDraggable,
  useDroppable,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  useDispatchBoard,
  useReassignDispatch,
  useRescheduleJob,
  useUnscheduleJob,
} from "../hooks/useDispatch";
import { useJobs, useDeleteJob } from "../hooks/useJobs";
import { useTechnicians } from "../hooks/useTechnicians";
import Modal from "../components/ui/Modal";
import Button from "../components/ui/Button";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { PageSpinner } from "../components/ui/Spinner";
import { formatCurrency } from "../utils/formatters";
import { Job } from "../types";

const HOUR_START = 7;
const HOUR_END = 19;
const HOUR_WIDTH = 120;
const ROW_HEIGHT = 84;
const HOURS = Array.from(
  { length: HOUR_END - HOUR_START },
  (_, i) => HOUR_START + i,
);

const UNASSIGNED_ID = "unassigned";
const UNDATED_ID = "undated";
// Ignore tiny horizontal jitter; snap reschedules to 15-minute increments.
const MIN_SHIFT_PX = 12;
const SNAP_MIN = 15;

// Shift a job's scheduled time by a horizontal drag distance (in pixels),
// snapped to 15 minutes and clamped within the board's visible hours.
function shiftJobTime(
  job: Job,
  deltaX: number,
): { scheduledStart: string; scheduledEnd: string } | null {
  if (!job.scheduledStart) return null;
  const start = parseISO(job.scheduledStart);
  const duration = job.scheduledEnd
    ? parseISO(job.scheduledEnd).getTime() - start.getTime()
    : 60 * 60000;

  const deltaMs = (deltaX / HOUR_WIDTH) * 60 * 60000;
  const snapMs = SNAP_MIN * 60000;
  let newStartMs = Math.round((start.getTime() + deltaMs) / snapMs) * snapMs;

  const dayStart = new Date(start);
  dayStart.setHours(HOUR_START, 0, 0, 0);
  const dayEnd = new Date(start);
  dayEnd.setHours(HOUR_END, 0, 0, 0);
  const minMs = dayStart.getTime();
  const maxMs = Math.max(minMs, dayEnd.getTime() - duration);
  newStartMs = Math.min(Math.max(newStartMs, minMs), maxMs);

  return {
    scheduledStart: new Date(newStartMs).toISOString(),
    scheduledEnd: new Date(newStartMs + duration).toISOString(),
  };
}

const JOB_TYPE_COLORS: Record<string, string> = {
  service: "bg-blue-500",
  installation: "bg-green-500",
  maintenance: "bg-yellow-500",
  inspection: "bg-purple-500",
};

function getJobPosition(job: Job): { left: number; width: number } | null {
  if (!job.scheduledStart) return null;
  try {
    const start = parseISO(job.scheduledStart);
    const startMins = start.getHours() * 60 + start.getMinutes();
    const totalMins = (HOUR_END - HOUR_START) * 60;
    const offsetMins = startMins - HOUR_START * 60;
    if (offsetMins < 0 || offsetMins > totalMins) return null;

    let durationMins = 60;
    if (job.scheduledEnd) {
      const end = parseISO(job.scheduledEnd);
      durationMins = Math.max(30, (end.getTime() - start.getTime()) / 60000);
    }

    const left = (offsetMins / 60) * HOUR_WIDTH;
    const width = Math.max(
      HOUR_WIDTH / 2,
      (durationMins / 60) * HOUR_WIDTH - 4,
    );
    return { left, width };
  } catch {
    return null;
  }
}

// Convert a UTC ISO instant to the local "YYYY-MM-DDTHH:mm" a datetime-local
// input expects (the inverse of new Date(value).toISOString() on save).
function isoToLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

// Map where a job was dropped on the board to a scheduled start/end (ISO):
// the pointer's X within the technician row -> a time on the board's date,
// snapped to 15 minutes and clamped to the visible hours.
function dropTimeOnBoard(
  event: DragEndEvent,
  boardDate: Date,
): { scheduledStart: string; scheduledEnd: string } | null {
  const over = event.over;
  const activator = event.activatorEvent as { clientX?: number };
  if (!over || typeof activator.clientX !== "number") return null;
  const relX = activator.clientX + event.delta.x - over.rect.left;
  const totalMin = (HOUR_END - HOUR_START) * 60;
  let min = Math.round(((relX / HOUR_WIDTH) * 60) / SNAP_MIN) * SNAP_MIN;
  min = Math.min(Math.max(min, 0), totalMin - 60);
  const start = new Date(boardDate);
  start.setHours(HOUR_START, 0, 0, 0);
  start.setMinutes(start.getMinutes() + min);
  return {
    scheduledStart: start.toISOString(),
    scheduledEnd: new Date(start.getTime() + 60 * 60000).toISOString(),
  };
}

interface JobCardProps {
  job: Job;
  compact?: boolean;
  onClick?: () => void;
  draggable?: boolean;
}

function JobCard({
  job,
  compact = false,
  onClick,
  draggable = false,
}: JobCardProps) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: job.id,
    disabled: !draggable,
  });

  const color = JOB_TYPE_COLORS[job.type] ?? "bg-gray-500";

  if (compact) {
    return (
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        onClick={onClick}
        className={clsx(
          "h-full flex flex-col justify-center overflow-hidden rounded-md text-white px-2.5 py-1.5 cursor-pointer select-none",
          color,
          isDragging ? "opacity-50" : "hover:opacity-90",
          "shadow-sm",
        )}
        style={{ fontSize: "11px", lineHeight: "1.35" }}
      >
        <div className="font-semibold truncate">#{job.jobNumber}</div>
        <div className="truncate opacity-90">
          {job.customer
            ? `${job.customer.firstName} ${job.customer.lastName}`
            : ""}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={draggable ? setNodeRef : undefined}
      {...(draggable ? listeners : {})}
      {...(draggable ? attributes : {})}
      onClick={onClick}
      className={clsx(
        "rounded-lg border border-gray-200 p-3 cursor-pointer hover:shadow-sm transition-all",
        "bg-white",
        isDragging && "opacity-50",
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <div className={clsx("h-2 w-2 rounded-full", color)} />
        <span className="text-xs font-bold text-gray-700">
          #{job.jobNumber}
        </span>
      </div>
      <p className="text-xs font-medium text-gray-900 truncate">
        {job.customer
          ? `${job.customer.firstName} ${job.customer.lastName}`
          : "Unknown"}
      </p>
      <p className="text-xs text-gray-500 truncate mt-0.5">{job.summary}</p>
      <p className="text-xs font-semibold text-gray-700 mt-1">
        {formatCurrency(job.totalAmount)}
      </p>
    </div>
  );
}

interface DroppableTechRowProps {
  techId: string;
  jobs: Job[];
  onJobClick: (job: Job) => void;
}

function DroppableTechRow({ techId, jobs, onJobClick }: DroppableTechRowProps) {
  const { setNodeRef, isOver } = useDroppable({ id: techId });

  return (
    <div
      ref={setNodeRef}
      className={clsx(
        "relative border-b border-gray-100 transition-colors",
        isOver ? "bg-primary-50" : "hover:bg-gray-50",
      )}
      style={{ height: ROW_HEIGHT }}
    >
      {/* Hour grid lines */}
      {HOURS.map((h, idx) => (
        <div
          key={h}
          className="absolute top-0 bottom-0 border-l border-gray-100"
          style={{ left: idx * HOUR_WIDTH }}
        />
      ))}

      {/* Job cards */}
      {jobs.map((job) => {
        const pos = getJobPosition(job);
        if (!pos) return null;
        return (
          <div
            key={job.id}
            className="absolute top-1 bottom-1"
            style={{ left: pos.left + 2, width: pos.width }}
          >
            <JobCard
              job={job}
              compact
              onClick={() => {
                onJobClick(job);
              }}
              draggable
            />
          </div>
        );
      })}
    </div>
  );
}

interface UnassignedPanelProps {
  jobs: Job[];
  onJobClick: (job: Job) => void;
}

function UnassignedPanel({ jobs, onJobClick }: UnassignedPanelProps) {
  const { setNodeRef, isOver } = useDroppable({ id: UNASSIGNED_ID });

  return (
    <div className="w-56 shrink-0">
      <div
        ref={setNodeRef}
        className={clsx(
          "bg-white rounded-xl shadow-sm border h-full flex flex-col transition-colors",
          isOver ? "border-primary-300 bg-primary-50" : "border-gray-100",
        )}
      >
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase">
            Unassigned ({jobs.length})
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {jobs.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">
              Drag a job here to unassign it
            </p>
          ) : (
            jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onClick={() => {
                  onJobClick(job);
                }}
                draggable
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

interface UndatedPanelProps {
  jobs: Job[];
  onJobClick: (job: Job) => void;
}

function UndatedPanel({ jobs, onJobClick }: UndatedPanelProps) {
  const { setNodeRef, isOver } = useDroppable({ id: UNDATED_ID });
  return (
    <div className="w-56 shrink-0">
      <div
        ref={setNodeRef}
        className={clsx(
          "bg-white rounded-xl shadow-sm border h-full flex flex-col transition-colors",
          isOver ? "border-primary-300 bg-primary-50" : "border-gray-100",
        )}
      >
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase">
            Undated ({jobs.length})
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {jobs.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">
              Drag a job here to clear its date. Jobs without a date live here -
              drag one onto the board to schedule it.
            </p>
          ) : (
            jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                onClick={() => {
                  onJobClick(job);
                }}
                draggable
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

interface ScheduleEditorProps {
  job: Job;
  saving: boolean;
  onSave: (vars: { scheduledStart: string; scheduledEnd: string }) => void;
}

function ScheduleEditor({ job, saving, onSave }: ScheduleEditorProps) {
  const [start, setStart] = useState(isoToLocalInput(job.scheduledStart));
  const [end, setEnd] = useState(isoToLocalInput(job.scheduledEnd));

  useEffect(() => {
    setStart(isoToLocalInput(job.scheduledStart));
    setEnd(isoToLocalInput(job.scheduledEnd));
  }, [job.id, job.scheduledStart, job.scheduledEnd]);

  const save = () => {
    if (!start) return;
    const startDate = new Date(start);
    const endDate = end
      ? new Date(end)
      : new Date(startDate.getTime() + 60 * 60000);
    onSave({
      scheduledStart: startDate.toISOString(),
      scheduledEnd: endDate.toISOString(),
    });
  };

  return (
    <div className="border-t border-gray-100 pt-3">
      <dt className="text-xs text-gray-500 mb-2">Schedule</dt>
      <dd className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => {
              setEnd(e.target.value);
            }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <Button size="sm" disabled={!start || saving} onClick={save}>
          {job.scheduledStart ? "Update schedule" : "Schedule job"}
        </Button>
      </dd>
    </div>
  );
}

export default function DispatchPage() {
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [assignTechId, setAssignTechId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingClear, setPendingClear] = useState<{
    type: "tech" | "date";
    jobId: string;
    jobNumber: string;
  } | null>(null);
  const dateStr = format(currentDate, "yyyy-MM-dd");

  const { data: boardData, isLoading } = useDispatchBoard(dateStr);
  const { data: allJobsData } = useJobs({ status: "new,scheduled", limit: 50 });
  const { data: techsData } = useTechnicians();
  const reassign = useReassignDispatch();
  const reschedule = useRescheduleJob();
  const unschedule = useUnscheduleJob();
  const deleteJob = useDeleteJob();

  // Require an 8px drag before dragging starts, so a plain click still opens
  // the job modal (where you can delete it) instead of being swallowed.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const board = boardData;
  const allTechs = techsData?.data ?? [];
  const unassignedJobs =
    board?.unassigned ??
    allJobsData?.data.filter((j) => !j.technicians?.length) ??
    [];
  const techRows =
    board?.technicians ?? allTechs.map((t) => ({ ...t, jobs: [] as Job[] }));
  const undatedJobs = board?.undated ?? [];

  // Find which technician a job is currently assigned to on the board.
  const findCurrentTech = (jobId: string): string | null =>
    techRows.find((t) => t.jobs.some((j) => j.id === jobId))?.id ?? null;

  // Derive the selected job from live board data so the modal stays in sync
  // after assigning/removing technicians.
  const selectedJob =
    (selectedJobId
      ? [
          ...techRows.flatMap((t) => t.jobs),
          ...unassignedJobs,
          ...undatedJobs,
        ].find((j) => j.id === selectedJobId)
      : null) ?? null;

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    const job =
      unassignedJobs.find((j) => j.id === id) ??
      undatedJobs.find((j) => j.id === id) ??
      techRows.flatMap((t) => t.jobs).find((j) => j.id === id);
    setActiveJob(job ?? null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveJob(null);
    const { active, over, delta } = event;
    if (!over) return;
    const jobId = String(active.id);
    const target = String(over.id);
    const job = [
      ...techRows.flatMap((t) => t.jobs),
      ...unassignedJobs,
      ...undatedJobs,
    ].find((j) => j.id === jobId);

    // Drop on the Unassigned panel -> confirm, then remove technician(s)
    // (the date is kept).
    if (target === UNASSIGNED_ID) {
      if (job?.technicians?.length) {
        setPendingClear({ type: "tech", jobId, jobNumber: job.jobNumber });
      }
      return;
    }

    // Drop on the Undated panel -> confirm, then clear the date
    // (the technicians are kept).
    if (target === UNDATED_ID) {
      if (job?.scheduledStart) {
        setPendingClear({ type: "date", jobId, jobNumber: job.jobNumber });
      }
      return;
    }

    // An undated job dropped on a technician row gets scheduled on the
    // board's date at the dropped time, and assigned to that technician.
    if (job && !job.scheduledStart) {
      const times = dropTimeOnBoard(event, currentDate);
      if (times) reschedule.mutate({ jobId, ...times, date: dateStr });
      reassign.mutate({ jobId, toTechnicianId: target, date: dateStr });
      return;
    }

    const fromTech = findCurrentTech(jobId);

    // Horizontal drag along the timeline -> reschedule to a new time.
    if (job?.scheduledStart && Math.abs(delta.x) >= MIN_SHIFT_PX) {
      const times = shiftJobTime(job, delta.x);
      if (times) reschedule.mutate({ jobId, ...times, date: dateStr });
    }

    // Vertical drag to a different row -> reassign to that technician.
    if (target !== fromTech) {
      reassign.mutate({ jobId, toTechnicianId: target, date: dateStr });
    }
  };

  const assignedTechIds = new Set(
    selectedJob?.technicians?.map((jt) => jt.technicianId) ?? [],
  );
  const availableTechs = allTechs.filter((t) => !assignedTechIds.has(t.id));

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Date Navigation */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setCurrentDate(subDays(currentDate, 1));
            }}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <CalendarDaysIcon className="h-4 w-4 text-gray-400" />
            <span className="font-semibold text-gray-900">
              {format(currentDate, "EEEE, MMMM d, yyyy")}
            </span>
          </div>
          <button
            onClick={() => {
              setCurrentDate(addDays(currentDate, 1));
            }}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setCurrentDate(new Date());
            }}
            className="px-3 py-1.5 text-sm font-medium bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Today
          </button>
          <Button
            size="sm"
            icon={<PlusIcon className="h-4 w-4" />}
            onClick={() => {
              navigate("/jobs/new");
            }}
          >
            New Job
          </Button>
        </div>
      </div>

      {isLoading ? (
        <PageSpinner />
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 flex-1 min-h-0">
            {/* Board */}
            <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-100 overflow-auto">
              {/* Header row: Technician label + time slots */}
              <div className="flex sticky top-0 z-10 bg-white border-b border-gray-200">
                <div
                  className="shrink-0 border-r border-gray-200 flex items-center px-4 py-3"
                  style={{ width: 180 }}
                >
                  <span className="text-xs font-semibold text-gray-500 uppercase">
                    Technician
                  </span>
                </div>
                <div className="flex">
                  {HOURS.map((h) => (
                    <div
                      key={h}
                      className="border-l border-gray-100 flex items-center justify-start px-2 py-3"
                      style={{ width: HOUR_WIDTH, minWidth: HOUR_WIDTH }}
                    >
                      <span className="text-xs text-gray-400 font-medium">
                        {h === 12
                          ? "12pm"
                          : h > 12
                            ? `${String(h - 12)}pm`
                            : `${String(h)}am`}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tech rows */}
              {techRows.length === 0 ? (
                <div className="py-16 text-center text-gray-400 text-sm">
                  No technicians found. Add technicians to see the dispatch
                  board.
                </div>
              ) : (
                techRows.map((techRow) => (
                  <div
                    key={techRow.id}
                    className="flex border-b border-gray-100"
                  >
                    {/* Tech info */}
                    <div
                      className="shrink-0 border-r border-gray-200 flex items-center gap-3 px-4 bg-gray-50"
                      style={{ width: 180, minHeight: ROW_HEIGHT }}
                    >
                      <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0">
                        <span className="text-xs font-semibold text-primary-700">
                          {techRow.user.firstName.charAt(0)}
                          {techRow.user.lastName.charAt(0)}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-gray-900 truncate">
                          {techRow.user.firstName} {techRow.user.lastName}
                        </p>
                        <p
                          className={clsx(
                            "text-xs",
                            techRow.isAvailable
                              ? "text-green-600"
                              : "text-gray-400",
                          )}
                        >
                          {techRow.isAvailable ? "Available" : "Busy"}
                        </p>
                      </div>
                    </div>

                    {/* Time grid */}
                    <div
                      className="relative flex-1"
                      style={{
                        minWidth: HOURS.length * HOUR_WIDTH,
                        minHeight: ROW_HEIGHT,
                      }}
                    >
                      <DroppableTechRow
                        techId={techRow.id}
                        jobs={techRow.jobs}
                        onJobClick={(job) => {
                          setSelectedJobId(job.id);
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Unassigned panel (drop here to unassign) */}
            <UnassignedPanel
              jobs={unassignedJobs}
              onJobClick={(job) => {
                setSelectedJobId(job.id);
              }}
            />

            {/* Undated backlog (drag onto the board to schedule) */}
            <UndatedPanel
              jobs={undatedJobs}
              onJobClick={(job) => {
                setSelectedJobId(job.id);
              }}
            />
          </div>

          <DragOverlay>
            {activeJob && (
              <div className="bg-white rounded-lg border border-primary-200 shadow-lg p-3 w-48 opacity-90">
                <p className="text-xs font-bold text-primary-700">
                  #{activeJob.jobNumber}
                </p>
                <p className="text-xs text-gray-900 truncate">
                  {activeJob.summary}
                </p>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Job detail + assignment modal */}
      {selectedJob && (
        <>
          <Modal
            isOpen={Boolean(selectedJob)}
            onClose={() => {
              setSelectedJobId(null);
              setAssignTechId("");
            }}
            title={`Job #${selectedJob.jobNumber}`}
            size="md"
          >
            <dl className="space-y-3">
              <div>
                <dt className="text-xs text-gray-500">Customer</dt>
                <dd className="text-sm font-medium text-gray-900 mt-0.5">
                  {selectedJob.customer
                    ? `${selectedJob.customer.firstName} ${selectedJob.customer.lastName}`
                    : "-"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Summary</dt>
                <dd className="text-sm text-gray-700 mt-0.5">
                  {selectedJob.summary}
                </dd>
              </div>
              {selectedJob.location && (
                <div>
                  <dt className="text-xs text-gray-500">Location</dt>
                  <dd className="text-sm text-gray-700 mt-0.5">
                    {selectedJob.location.address}, {selectedJob.location.city}
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-gray-500">Amount</dt>
                <dd className="text-sm font-bold text-gray-900 mt-0.5">
                  {formatCurrency(selectedJob.totalAmount)}
                </dd>
              </div>

              {/* Assigned technicians (dispatches) */}
              <div className="border-t border-gray-100 pt-3">
                <dt className="text-xs text-gray-500 mb-2">
                  Assigned technicians
                </dt>
                <dd className="space-y-2">
                  {selectedJob.technicians &&
                  selectedJob.technicians.length > 0 ? (
                    selectedJob.technicians.map((jt) => (
                      <div
                        key={jt.id}
                        className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2"
                      >
                        <span className="text-sm text-gray-800">
                          {jt.technician?.user
                            ? `${jt.technician.user.firstName} ${jt.technician.user.lastName}`
                            : "Technician"}
                          {jt.isLead && (
                            <span className="ml-2 text-[10px] uppercase font-semibold text-primary-600">
                              Lead
                            </span>
                          )}
                        </span>
                        <button
                          onClick={() => {
                            reassign.mutate({
                              jobId: selectedJob.id,
                              toTechnicianId: null,
                              date: dateStr,
                            });
                          }}
                          disabled={reassign.isPending}
                          title="Remove (unassign)"
                          className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
                        >
                          <XMarkIcon className="h-4 w-4" />
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-gray-400">
                      Unassigned — assign a technician below.
                    </p>
                  )}

                  {/* Assign a technician */}
                  <div className="flex gap-2 pt-1">
                    <select
                      value={assignTechId}
                      onChange={(e) => {
                        setAssignTechId(e.target.value);
                      }}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                    >
                      <option value="">Assign technician…</option>
                      {availableTechs.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.user.firstName} {t.user.lastName}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      disabled={!assignTechId || reassign.isPending}
                      onClick={() => {
                        if (!assignTechId) return;
                        reassign.mutate({
                          jobId: selectedJob.id,
                          toTechnicianId: assignTechId,
                          date: dateStr,
                        });
                        setAssignTechId("");
                      }}
                    >
                      Assign
                    </Button>
                  </div>
                </dd>
              </div>

              {/* Schedule (assign or change the job's date) */}
              <ScheduleEditor
                job={selectedJob}
                saving={reschedule.isPending}
                onSave={(vars) => {
                  reschedule.mutate({
                    jobId: selectedJob.id,
                    ...vars,
                    date: dateStr,
                  });
                }}
              />

              {/* Footer actions */}
              <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    navigate(`/jobs/${selectedJob.id}`);
                  }}
                >
                  Open job
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  icon={<TrashIcon className="h-4 w-4" />}
                  onClick={() => {
                    setConfirmDelete(true);
                  }}
                >
                  Delete job
                </Button>
              </div>
            </dl>
          </Modal>

          <ConfirmDialog
            isOpen={confirmDelete}
            onClose={() => {
              setConfirmDelete(false);
            }}
            onConfirm={() => {
              deleteJob.mutate(selectedJob.id, {
                onSuccess: () => {
                  setConfirmDelete(false);
                  setSelectedJobId(null);
                },
              });
            }}
            title="Delete job"
            message={`Delete job #${selectedJob.jobNumber}? It will be removed from the schedule. Linked invoices and estimates are kept but detached from the job.`}
            confirmLabel="Delete"
            loading={deleteJob.isPending}
          />
        </>
      )}

      {/* Confirm before a drag clears a job's technician or date. */}
      <ConfirmDialog
        isOpen={Boolean(pendingClear)}
        onClose={() => {
          setPendingClear(null);
        }}
        onConfirm={() => {
          if (!pendingClear) return;
          if (pendingClear.type === "tech") {
            reassign.mutate({
              jobId: pendingClear.jobId,
              toTechnicianId: null,
              date: dateStr,
            });
          } else {
            unschedule.mutate({ jobId: pendingClear.jobId, date: dateStr });
          }
          setPendingClear(null);
        }}
        title={
          pendingClear?.type === "tech"
            ? "Remove technician"
            : "Clear scheduled date"
        }
        message={
          pendingClear?.type === "tech"
            ? `Remove the technician from job #${pendingClear?.jobNumber ?? ""}? It will move to the Unassigned list; the date is kept.`
            : `Clear the scheduled date for job #${pendingClear?.jobNumber ?? ""}? It will move to the Undated list; the technician is kept.`
        }
        confirmLabel={
          pendingClear?.type === "tech" ? "Remove technician" : "Clear date"
        }
        loading={reassign.isPending || unschedule.isPending}
      />
    </div>
  );
}
