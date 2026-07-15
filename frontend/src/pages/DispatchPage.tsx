import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  format,
  addDays,
  subDays,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  parseISO,
} from "date-fns";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CalendarDaysIcon,
  XMarkIcon,
  PlusIcon,
  ArchiveBoxIcon,
  MapPinIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  useDraggable,
  useDroppable,
  DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  useDispatchBoard,
  useReassignDispatch,
  useRescheduleJob,
  useUnscheduleJob,
  useDispatchRealtime,
} from "../hooks/useDispatch";
import { useJobs, useArchiveJob, useUpdateJobStatus } from "../hooks/useJobs";
import { useTechnicians } from "../hooks/useTechnicians";
import Modal from "../components/ui/Modal";
import Button from "../components/ui/Button";
import { StatusBadge } from "../components/ui/Badge";
import { Can } from "../components/ui/Can";
import { useLookup } from "../hooks/useMetadata";
import { useDragScroll } from "../hooks/useDragScroll";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { PageSpinner } from "../components/ui/Spinner";
import { formatCurrency } from "../utils/formatters";
import { Job, Technician } from "../types";

// Full 24-hour day so jobs scheduled at any hour show on the board.
const HOUR_START = 0;
const HOUR_END = 24;
// Utilization is measured against a normal workday, not the full 24h span, so
// the per-tech load bar stays meaningful.
const WORKDAY_HOURS = 8;
const HOUR_WIDTH = 120;
const ROW_HEIGHT = 128;
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

// Derive a solid card color from a DB-driven status badge color
// (e.g. "bg-blue-100 text-blue-800" -> "bg-blue-500") so dispatch cards match
// the job's status everywhere else in the app.
function solidStatusColor(badge: string): string {
  const match = /bg-([a-z]+)-\d+/.exec(badge);
  return match ? `bg-${match[1]}-500` : "bg-gray-500";
}

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
  const { getColor } = useLookup("jobStatus");
  const color = solidStatusColor(getColor(job.status));

  if (compact) {
    const customerName = job.customer
      ? `${job.customer.firstName} ${job.customer.lastName}`
      : "Unknown";
    const leadTech =
      job.technicians?.find((t) => t.isLead) ?? job.technicians?.[0];
    const leadTechName = leadTech?.technician?.user
      ? `${leadTech.technician.user.firstName} ${leadTech.technician.user.lastName}`
      : null;
    const timeRange = job.scheduledStart
      ? `${format(parseISO(job.scheduledStart), "h:mmaaa")}${
          job.scheduledEnd
            ? `\u2013${format(parseISO(job.scheduledEnd), "h:mmaaa")}`
            : ""
        }`
      : null;
    const locationText = job.location
      ? [job.location.address, job.location.city].filter(Boolean).join(", ")
      : null;

    return (
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        onClick={onClick}
        className={clsx(
          "h-full flex flex-col overflow-hidden rounded-md text-oncolor px-2 py-1.5 cursor-pointer select-none",
          color,
          isDragging ? "opacity-50" : "hover:opacity-90",
          "shadow-sm",
        )}
        style={{ fontSize: "11px", lineHeight: "1.3" }}
      >
        <div className="flex items-center justify-between gap-1">
          <span className="font-bold truncate">#{job.jobNumber}</span>
          {timeRange && (
            <span className="shrink-0 opacity-90 text-[10px] font-medium">
              {timeRange}
            </span>
          )}
        </div>
        <div className="font-medium truncate">{customerName}</div>
        {job.summary && (
          <div className="truncate opacity-90">{job.summary}</div>
        )}
        {locationText && (
          <div className="flex items-center gap-0.5 opacity-80 min-w-0">
            <MapPinIcon className="h-3 w-3 shrink-0" />
            <span className="truncate">{locationText}</span>
          </div>
        )}
        <div className="mt-auto flex items-center justify-between gap-1 pt-0.5">
          <span className="font-semibold">
            {formatCurrency(job.totalAmount)}
          </span>
          {leadTechName && (
            <span className="flex items-center gap-0.5 truncate opacity-80 text-[10px] min-w-0">
              <UserIcon className="h-3 w-3 shrink-0" />
              <span className="truncate">{leadTechName}</span>
            </span>
          )}
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
    <div className="w-full h-72 lg:h-auto lg:w-56 lg:shrink-0">
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
    <div className="w-full h-72 lg:h-auto lg:w-56 lg:shrink-0">
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

interface ScheduleBlockInput {
  /** Local-only key for React lists. */
  key: string;
  start: string;
  end: string;
}

interface ScheduleEditorProps {
  job: Job;
  saving: boolean;
  onSave: (vars: {
    scheduledStart: string;
    scheduledEnd: string;
    scheduleBlocks: { start: string; end: string }[];
  }) => void;
}

// Monotonic key source for freshly-added (unsaved) blocks.
let scheduleBlockKeySeq = 0;

const INPUT_CLASS =
  "px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500";

function minutesBetween(startLocal: string, endLocal: string): number {
  if (!startLocal || !endLocal) return 0;
  const ms = new Date(endLocal).getTime() - new Date(startLocal).getTime();
  return ms > 0 ? Math.round(ms / 60000) : 0;
}

function formatHours(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0) return m > 0 ? `${String(h)}h ${String(m)}m` : `${String(h)}h`;
  return `${String(m)}m`;
}

function ScheduleEditor({ job, saving, onSave }: ScheduleEditorProps) {
  const [start, setStart] = useState(isoToLocalInput(job.scheduledStart));
  const [end, setEnd] = useState(isoToLocalInput(job.scheduledEnd));
  // Additional time windows beyond the primary start/end above.
  const [blocks, setBlocks] = useState<ScheduleBlockInput[]>([]);

  useEffect(() => {
    setStart(isoToLocalInput(job.scheduledStart));
    setEnd(isoToLocalInput(job.scheduledEnd));
    setBlocks(
      (job.scheduleBlocks ?? []).map((b) => ({
        key: `saved-${b.id}`,
        start: isoToLocalInput(b.start),
        end: isoToLocalInput(b.end),
      })),
    );
  }, [job.id, job.scheduledStart, job.scheduledEnd, job.scheduleBlocks]);

  const addBlock = () => {
    setBlocks((bs) => [
      ...bs,
      { key: `new-${String(++scheduleBlockKeySeq)}`, start: "", end: "" },
    ]);
  };
  const updateBlock = (key: string, field: "start" | "end", value: string) => {
    setBlocks((bs) =>
      bs.map((b) => (b.key === key ? { ...b, [field]: value } : b)),
    );
  };
  const removeBlock = (key: string) => {
    setBlocks((bs) => bs.filter((b) => b.key !== key));
  };

  // A half-filled additional block would be dropped silently on save, so block
  // the save until every added row has both a start and an end.
  const hasIncompleteBlock = blocks.some((b) => !b.start || !b.end);
  const totalMins =
    minutesBetween(start, end) +
    blocks.reduce((sum, b) => sum + minutesBetween(b.start, b.end), 0);
  const filledBlockCount = blocks.filter((b) => b.start && b.end).length;

  const save = () => {
    if (!start) return;
    const startDate = new Date(start);
    const endDate = end
      ? new Date(end)
      : new Date(startDate.getTime() + 60 * 60000);
    onSave({
      scheduledStart: startDate.toISOString(),
      scheduledEnd: endDate.toISOString(),
      scheduleBlocks: blocks
        .filter((b) => b.start && b.end)
        .map((b) => ({
          start: new Date(b.start).toISOString(),
          end: new Date(b.end).toISOString(),
        })),
    });
  };

  return (
    <div className="border-t border-gray-100 pt-3">
      <dt className="text-xs text-gray-500 mb-2">Schedule</dt>
      <dd className="space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
            }}
            className={INPUT_CLASS}
          />
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => {
              setEnd(e.target.value);
            }}
            className={INPUT_CLASS}
          />
        </div>

        {/* Additional time blocks (e.g. the job ran long or needed a return
            visit). Each is its own start/end pair. */}
        {blocks.map((b) => (
          <div key={b.key} className="flex items-center gap-2">
            <input
              type="datetime-local"
              value={b.start}
              onChange={(e) => {
                updateBlock(b.key, "start", e.target.value);
              }}
              className={`${INPUT_CLASS} flex-1 min-w-0`}
            />
            <input
              type="datetime-local"
              value={b.end}
              onChange={(e) => {
                updateBlock(b.key, "end", e.target.value);
              }}
              className={`${INPUT_CLASS} flex-1 min-w-0`}
            />
            <button
              type="button"
              onClick={() => {
                removeBlock(b.key);
              }}
              title="Remove time block"
              className="p-1 shrink-0 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={addBlock}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
        >
          <PlusIcon className="h-4 w-4" />
          Add time block
        </button>

        {totalMins > 0 && (
          <p className="text-xs text-gray-500">
            Total scheduled time:{" "}
            <span className="font-medium text-gray-700">
              {formatHours(totalMins)}
            </span>
            {filledBlockCount > 0
              ? ` across ${String(filledBlockCount + 1)} blocks`
              : ""}
          </p>
        )}

        <Button
          size="sm"
          disabled={!start || saving || hasIncompleteBlock}
          onClick={save}
        >
          {job.scheduledStart ? "Update schedule" : "Schedule job"}
        </Button>
      </dd>
    </div>
  );
}

const VIEW_MODES = ["day", "week", "month"] as const;
type ViewMode = (typeof VIEW_MODES)[number];

// Move a job to a different calendar day, preserving its time-of-day and
// duration (defaults to 9:00 for one hour if it had no time).
function moveToDay(
  job: Job,
  dayStr: string,
): { scheduledStart: string; scheduledEnd: string } {
  const base = job.scheduledStart ? new Date(job.scheduledStart) : null;
  const [y, m, d] = dayStr.split("-").map(Number);
  const start = new Date(
    y,
    m - 1,
    d,
    base ? base.getHours() : 9,
    base ? base.getMinutes() : 0,
    0,
    0,
  );
  const duration =
    job.scheduledStart && job.scheduledEnd
      ? new Date(job.scheduledEnd).getTime() -
        new Date(job.scheduledStart).getTime()
      : 60 * 60000;
  return {
    scheduledStart: start.toISOString(),
    scheduledEnd: new Date(start.getTime() + duration).toISOString(),
  };
}

// Draggable job chip for the Week/Month grids (date/tech buckets, no time
// axis). Mirrors the richer day-view card so all views surface the same
// customer / summary / location / amount / lead-tech details.
function JobChip({ job, onClick }: { job: Job; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: job.id,
  });
  const { getColor } = useLookup("jobStatus");
  const color = solidStatusColor(getColor(job.status));

  const customerName = job.customer
    ? `${job.customer.firstName} ${job.customer.lastName}`
    : "Unknown";
  const leadTech =
    job.technicians?.find((t) => t.isLead) ?? job.technicians?.[0];
  const leadTechName = leadTech?.technician?.user
    ? `${leadTech.technician.user.firstName} ${leadTech.technician.user.lastName}`
    : null;
  const timeRange = job.scheduledStart
    ? `${format(parseISO(job.scheduledStart), "h:mmaaa")}${
        job.scheduledEnd
          ? `\u2013${format(parseISO(job.scheduledEnd), "h:mmaaa")}`
          : ""
      }`
    : null;
  const locationText = job.location
    ? [job.location.address, job.location.city].filter(Boolean).join(", ")
    : null;

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={clsx(
        "rounded-md text-oncolor px-2 py-1.5 cursor-pointer select-none shadow-sm space-y-0.5",
        color,
        isDragging ? "opacity-50" : "hover:opacity-90",
      )}
      style={{ fontSize: "10px", lineHeight: "1.3" }}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="font-bold truncate">#{job.jobNumber}</span>
        {timeRange && (
          <span className="shrink-0 opacity-90 text-[10px] font-medium">
            {timeRange}
          </span>
        )}
      </div>
      <div className="font-medium truncate">{customerName}</div>
      {job.summary && <div className="truncate opacity-90">{job.summary}</div>}
      {locationText && (
        <div className="flex items-center gap-0.5 opacity-80 min-w-0">
          <MapPinIcon className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{locationText}</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-1">
        <span className="font-semibold">{formatCurrency(job.totalAmount)}</span>
        {leadTechName && (
          <span className="flex items-center gap-0.5 truncate opacity-80 text-[10px] min-w-0">
            <UserIcon className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{leadTechName}</span>
          </span>
        )}
      </div>
    </div>
  );
}

interface TechDayCellProps {
  techId: string;
  day: Date;
  jobs: Job[];
  onJobClick: (job: Job) => void;
}

function TechDayCell({ techId, day, jobs, onJobClick }: TechDayCellProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `week:${techId}:${format(day, "yyyy-MM-dd")}`,
  });
  const dayJobs = jobs.filter(
    (j) => j.scheduledStart && isSameDay(parseISO(j.scheduledStart), day),
  );
  return (
    <div
      ref={setNodeRef}
      className={clsx(
        "flex-1 border-l border-gray-100 p-1.5 space-y-1.5 transition-colors",
        isOver && "bg-primary-50",
      )}
      style={{ minWidth: 120, minHeight: ROW_HEIGHT }}
    >
      {dayJobs.map((job) => (
        <JobChip
          key={job.id}
          job={job}
          onClick={() => {
            onJobClick(job);
          }}
        />
      ))}
    </div>
  );
}

interface WeekGridProps {
  techRows: (Technician & { jobs: Job[] })[];
  days: Date[];
  onJobClick: (job: Job) => void;
}

function WeekGrid({ techRows, days, onJobClick }: WeekGridProps) {
  return (
    <div className="flex-1 min-w-0 bg-white rounded-xl shadow-sm border border-gray-100 overflow-auto">
      <div className="flex sticky top-0 z-10 bg-white border-b border-gray-200">
        <div
          className="shrink-0 border-r border-gray-200 flex items-center px-4 py-3"
          style={{ width: 180 }}
        >
          <span className="text-xs font-semibold text-gray-500 uppercase">
            Technician
          </span>
        </div>
        {days.map((d) => {
          const isToday = isSameDay(d, new Date());
          return (
            <div
              key={d.toISOString()}
              className={clsx(
                "flex-1 border-l border-gray-100 px-2 py-3 text-center",
                isToday && "bg-primary-50",
              )}
              style={{ minWidth: 120 }}
            >
              <span
                className={clsx(
                  "text-xs font-medium",
                  isToday ? "text-primary-700 font-semibold" : "text-gray-500",
                )}
              >
                {format(d, "EEE d")}
              </span>
            </div>
          );
        })}
      </div>
      {techRows.length === 0 ? (
        <div className="py-16 text-center text-gray-400 text-sm">
          No technicians found.
        </div>
      ) : (
        techRows.map((techRow) => (
          <div key={techRow.id} className="flex border-b border-gray-100">
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
                    techRow.isAvailable ? "text-green-600" : "text-gray-400",
                  )}
                >
                  {techRow.isAvailable ? "Available" : "Busy"}
                </p>
              </div>
            </div>
            {days.map((d) => (
              <TechDayCell
                key={d.toISOString()}
                techId={techRow.id}
                day={d}
                jobs={techRow.jobs}
                onJobClick={onJobClick}
              />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

interface MonthDayCellProps {
  day: Date;
  jobs: Job[];
  inMonth: boolean;
  onJobClick: (job: Job) => void;
}

function MonthDayCell({ day, jobs, inMonth, onJobClick }: MonthDayCellProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `month:${format(day, "yyyy-MM-dd")}`,
  });
  const dayJobs = jobs.filter(
    (j) => j.scheduledStart && isSameDay(parseISO(j.scheduledStart), day),
  );
  return (
    <div
      ref={setNodeRef}
      className={clsx(
        "border-l border-t border-gray-100 p-1.5 flex flex-col gap-1 overflow-hidden",
        !inMonth && "bg-gray-50",
        isOver && "bg-primary-50",
      )}
      style={{ minHeight: 180 }}
    >
      <span className="text-xs font-medium">
        {isSameDay(day, new Date()) ? (
          <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-primary-600 px-1 text-oncolor">
            {format(day, "d")}
          </span>
        ) : (
          <span className={inMonth ? "text-gray-500" : "text-gray-300"}>
            {format(day, "d")}
          </span>
        )}
      </span>
      <div className="space-y-1 overflow-y-auto">
        {dayJobs.slice(0, 3).map((job) => (
          <JobChip
            key={job.id}
            job={job}
            onClick={() => {
              onJobClick(job);
            }}
          />
        ))}
        {dayJobs.length > 3 && (
          <span className="text-[10px] text-gray-400">
            +{dayJobs.length - 3} more
          </span>
        )}
      </div>
    </div>
  );
}

interface MonthGridProps {
  days: Date[];
  jobs: Job[];
  currentMonth: Date;
  onJobClick: (job: Job) => void;
}

function MonthGrid({ days, jobs, currentMonth, onJobClick }: MonthGridProps) {
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return (
    <div className="flex-1 min-w-0 bg-white rounded-xl shadow-sm border border-gray-100 overflow-auto flex flex-col">
      <div className="grid grid-cols-7 border-b border-gray-200">
        {labels.map((l) => (
          <div
            key={l}
            className="px-2 py-2 text-center text-xs font-semibold text-gray-500 uppercase"
          >
            {l}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 flex-1">
        {days.map((day) => (
          <MonthDayCell
            key={day.toISOString()}
            day={day}
            jobs={jobs}
            inMonth={isSameMonth(day, currentMonth)}
            onJobClick={onJobClick}
          />
        ))}
      </div>
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
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const dateStr = format(currentDate, "yyyy-MM-dd");

  // Date range to load + render, based on the active view mode.
  const rangeStart =
    viewMode === "day"
      ? currentDate
      : viewMode === "week"
        ? startOfWeek(currentDate)
        : startOfWeek(startOfMonth(currentDate));
  const rangeEnd =
    viewMode === "day"
      ? currentDate
      : viewMode === "week"
        ? endOfWeek(currentDate)
        : endOfWeek(endOfMonth(currentDate));
  const fromStr = format(rangeStart, "yyyy-MM-dd");
  const toStr = format(rangeEnd, "yyyy-MM-dd");
  const weekDays = eachDayOfInterval({
    start: startOfWeek(currentDate),
    end: endOfWeek(currentDate),
  });
  const monthDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(currentDate)),
    end: endOfWeek(endOfMonth(currentDate)),
  });

  const { data: boardData, isLoading } = useDispatchBoard(fromStr, toStr);
  // Live updates: reflect other users' board changes without a manual refresh.
  useDispatchRealtime(fromStr, toStr);
  const { data: allJobsData } = useJobs({ status: "new,scheduled", limit: 50 });
  const { data: techsData } = useTechnicians();
  const reassign = useReassignDispatch();
  const reschedule = useRescheduleJob();
  const unschedule = useUnscheduleJob();
  const archiveJob = useArchiveJob();
  const updateStatus = useUpdateJobStatus();
  const { options: statusOptions } = useLookup("jobStatus");

  // Mouse: require an 8px drag before dragging starts, so a plain click still
  // opens the job modal instead of being swallowed.
  // Touch: require a 200ms press-and-hold before dragging, so a quick tap opens
  // the job modal and a swipe scrolls the board rather than dragging a card.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    }),
  );

  // Grab-to-pan the day timeline (drag empty space to scroll the hours).
  const boardRef = useDragScroll();

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

    // Week view: dropped on a (technician, day) cell -> assign that
    // technician and move the job to that day (keeping its time-of-day). Only
    // reassign if the technician actually changed -- otherwise a same-row,
    // different-day drag fires a redundant reassign call that requires
    // dispatch.manage, so a dispatcher/CSR with jobs.edit but not
    // dispatch.manage would see a spurious "access denied" toast even though
    // the (permitted) date change already went through.
    if (target.startsWith("week:")) {
      const [, techId, day] = target.split(":");
      if (job && day) {
        reschedule.mutate({ jobId, ...moveToDay(job, day), date: dateStr });
        if (techId !== findCurrentTech(jobId)) {
          reassign.mutate({ jobId, toTechnicianId: techId, date: dateStr });
        }
      }
      return;
    }

    // Month view: dropped on a day cell -> move the job to that day
    // (keeping its time-of-day and technician).
    if (target.startsWith("month:")) {
      const [, day] = target.split(":");
      if (job && day) {
        reschedule.mutate({ jobId, ...moveToDay(job, day), date: dateStr });
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

  const stepBack = () => {
    setCurrentDate((d) =>
      viewMode === "day"
        ? subDays(d, 1)
        : viewMode === "week"
          ? subWeeks(d, 1)
          : subMonths(d, 1),
    );
  };
  const stepForward = () => {
    setCurrentDate((d) =>
      viewMode === "day"
        ? addDays(d, 1)
        : viewMode === "week"
          ? addWeeks(d, 1)
          : addMonths(d, 1),
    );
  };
  const rangeLabel =
    viewMode === "day"
      ? `${format(currentDate, "EEEE, MMMM d, yyyy")}${
          isSameDay(currentDate, new Date()) ? " \u00b7 Today" : ""
        }`
      : viewMode === "week"
        ? `${format(startOfWeek(currentDate), "MMM d")} - ${format(endOfWeek(currentDate), "MMM d, yyyy")}`
        : format(currentDate, "MMMM yyyy");

  // At-a-glance metrics for the current view, derived from already-loaded board
  // data (no extra requests). Fills the header band and gives the dispatcher a
  // quick read on workload, backlog, crew availability, and booked revenue.
  const scheduledJobs = techRows.flatMap((t) => t.jobs);
  const completedCount = scheduledJobs.filter(
    (j) => j.status === "completed",
  ).length;
  const bookedRevenue = scheduledJobs.reduce(
    (sum, j) => sum + (j.totalAmount || 0),
    0,
  );
  const availableTechCount = allTechs.filter((t) => t.isAvailable).length;
  const summaryStats: {
    label: string;
    value: string | number;
    alert?: boolean;
  }[] = [
    { label: "Scheduled", value: scheduledJobs.length },
    { label: "Completed", value: completedCount },
    {
      label: "Unassigned",
      value: unassignedJobs.length,
      alert: unassignedJobs.length > 0,
    },
    {
      label: "Undated",
      value: undatedJobs.length,
      alert: undatedJobs.length > 0,
    },
    {
      label: "Techs available",
      value: `${String(availableTechCount)}/${String(allTechs.length)}`,
    },
    { label: "Booked revenue", value: formatCurrency(bookedRevenue) },
  ];

  // Live "current time" indicator for the day view: only shown when viewing
  // today and the clock is within the board's visible hours.
  const now = new Date();
  const nowOffsetMins =
    now.getHours() * 60 + now.getMinutes() - HOUR_START * 60;
  const showNowLine =
    viewMode === "day" &&
    isSameDay(currentDate, now) &&
    nowOffsetMins >= 0 &&
    nowOffsetMins <= (HOUR_END - HOUR_START) * 60;
  const nowLeft = (nowOffsetMins / 60) * HOUR_WIDTH;

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Date Navigation */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={stepBack}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2">
            <CalendarDaysIcon className="h-4 w-4 text-gray-400" />
            <span className="font-semibold text-gray-900">{rangeLabel}</span>
          </div>
          <button
            onClick={stepForward}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500"
          >
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {VIEW_MODES.map((m) => (
              <button
                key={m}
                onClick={() => {
                  setViewMode(m);
                }}
                className={clsx(
                  "px-3 py-1.5 text-xs font-medium rounded-md capitalize transition-colors",
                  viewMode === m
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700",
                )}
              >
                {m}
              </button>
            ))}
          </div>
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

      {/* Summary metrics + status legend for the current view */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {summaryStats.map((s) => (
            <div key={s.label} className="flex items-baseline gap-1.5">
              <span
                className={clsx(
                  "text-lg font-bold",
                  s.alert ? "text-amber-600" : "text-gray-900",
                )}
              >
                {s.value}
              </span>
              <span className="text-xs text-gray-500">{s.label}</span>
            </div>
          ))}
        </div>
        {/* Status color key (matches the job-card colors on the board) */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {statusOptions.map((o) => (
            <div key={o.value} className="flex items-center gap-1.5">
              <span
                className={clsx(
                  "h-2.5 w-2.5 rounded-sm shrink-0",
                  solidStatusColor(o.color ?? ""),
                )}
              />
              <span className="text-[11px] text-gray-500">{o.label}</span>
            </div>
          ))}
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
          <div className="flex flex-col lg:flex-row gap-4 lg:flex-1 lg:min-h-0">
            {/* Board area. On mobile it gets an explicit height so the calendar
                is visible and scrolls internally (the fixed-width side panels
                otherwise crowded it off screen); on desktop it fills the row. */}
            <div className="flex h-[65vh] lg:h-auto lg:flex-1 min-h-0 min-w-0">
              {/* Day view: technician rows x hourly columns */}
              {viewMode === "day" && (
                <div
                  ref={boardRef}
                  className="flex-1 min-w-0 bg-white rounded-xl shadow-sm border border-gray-100 overflow-auto cursor-grab"
                >
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
                    <div className="flex relative">
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
                      {showNowLine && (
                        <span
                          className="absolute top-1.5 z-20 -translate-x-1/2 rounded bg-red-500 px-1 py-0.5 text-[10px] font-bold leading-none text-oncolor pointer-events-none"
                          style={{ left: nowLeft }}
                        >
                          {format(now, "h:mm")}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Tech rows */}
                  {techRows.length === 0 ? (
                    <div className="py-16 text-center text-gray-400 text-sm">
                      No technicians found. Add technicians to see the dispatch
                      board.
                    </div>
                  ) : (
                    techRows.map((techRow) => {
                      // Daily load for this technician: booked hours vs. the
                      // length of the visible workday, shown as a utilization bar.
                      const rowBookedMins = techRow.jobs.reduce((sum, j) => {
                        if (!j.scheduledStart) return sum;
                        const dur = j.scheduledEnd
                          ? (parseISO(j.scheduledEnd).getTime() -
                              parseISO(j.scheduledStart).getTime()) /
                            60000
                          : 60;
                        return sum + Math.max(0, dur);
                      }, 0);
                      const rowHours = (rowBookedMins / 60).toFixed(1);
                      const util = rowBookedMins / (WORKDAY_HOURS * 60);
                      const utilPct = Math.min(100, Math.round(util * 100));
                      const utilColor =
                        util > 1
                          ? "bg-red-500"
                          : util >= 0.8
                            ? "bg-amber-500"
                            : "bg-green-500";
                      return (
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
                              <p className="text-[11px] text-gray-500 mt-1">
                                {techRow.jobs.length}{" "}
                                {techRow.jobs.length === 1 ? "job" : "jobs"} ·{" "}
                                {rowHours}h
                              </p>
                              <div className="mt-1 h-1.5 w-full rounded-full bg-gray-200 overflow-hidden">
                                <div
                                  className={clsx(
                                    "h-full rounded-full",
                                    utilColor,
                                  )}
                                  style={{ width: `${String(utilPct)}%` }}
                                />
                              </div>
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
                            {showNowLine && (
                              <div
                                className="absolute top-0 bottom-0 z-20 w-0.5 bg-red-500 pointer-events-none"
                                style={{ left: nowLeft }}
                              />
                            )}
                            <DroppableTechRow
                              techId={techRow.id}
                              jobs={techRow.jobs}
                              onJobClick={(job) => {
                                setSelectedJobId(job.id);
                              }}
                            />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {viewMode === "week" && (
                <WeekGrid
                  techRows={techRows}
                  days={weekDays}
                  onJobClick={(job) => {
                    setSelectedJobId(job.id);
                  }}
                />
              )}

              {viewMode === "month" && (
                <MonthGrid
                  days={monthDays}
                  jobs={techRows.flatMap((t) => t.jobs)}
                  currentMonth={currentDate}
                  onJobClick={(job) => {
                    setSelectedJobId(job.id);
                  }}
                />
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
            title={`Work Order #${selectedJob.jobNumber}`}
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
                <dt className="text-xs text-gray-500">Status</dt>
                <dd className="mt-1 flex items-center gap-2">
                  <StatusBadge status={selectedJob.status} type="job" />
                  <select
                    value={selectedJob.status}
                    onChange={(e) => {
                      updateStatus.mutate({
                        id: selectedJob.id,
                        status: e.target.value,
                      });
                    }}
                    disabled={updateStatus.isPending}
                    className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white disabled:opacity-50"
                  >
                    {statusOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
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
                <Can permission="jobs.delete">
                  <Button
                    variant="outline"
                    size="sm"
                    icon={<ArchiveBoxIcon className="h-4 w-4" />}
                    onClick={() => {
                      setConfirmDelete(true);
                    }}
                  >
                    Archive job
                  </Button>
                </Can>
              </div>
            </dl>
          </Modal>

          <ConfirmDialog
            isOpen={confirmDelete}
            onClose={() => {
              setConfirmDelete(false);
            }}
            onConfirm={() => {
              archiveJob.mutate(selectedJob.id, {
                onSuccess: () => {
                  setConfirmDelete(false);
                  setSelectedJobId(null);
                },
              });
            }}
            title="Archive work order"
            message={`Archive work order #${selectedJob.jobNumber}? It's hidden from the schedule and active lists, but nothing is deleted -- you can restore it anytime from the Work Orders list.`}
            confirmLabel="Archive"
            loading={archiveJob.isPending}
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
            ? `Remove the technician from work order #${pendingClear.jobNumber}? It will move to the Unassigned list; the date is kept.`
            : `Clear the scheduled date for work order #${pendingClear?.jobNumber ?? ""}? It will move to the Undated list; the technician is kept.`
        }
        confirmLabel={
          pendingClear?.type === "tech" ? "Remove technician" : "Clear date"
        }
        loading={reassign.isPending || unschedule.isPending}
      />
    </div>
  );
}
