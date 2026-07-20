import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MapPinIcon,
  PhoneIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { useMyDay } from "../hooks/useMyDay";
import { useCurrentTimeEntry, useClockOut } from "../hooks/useTime";
import { jobQueryKey, fetchJob } from "../hooks/useJobs";
import { attachmentsQueryKey, fetchAttachments } from "../hooks/useAttachments";
import { StatusBadge } from "../components/ui/Badge";
import EmptyState from "../components/ui/EmptyState";
import { TableSkeleton } from "../components/ui/Skeleton";
import { dialOrCopyPhone } from "../utils/phone";
import { directionsUrl } from "../lib/maps";
import type { Job, Location } from "../types";

function toDateStr(d: Date): string {
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`);
}

function timeLabel(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function addressLine(loc: Location | undefined): string {
  if (!loc) return "";
  return [loc.address, loc.city, loc.state, loc.zip].filter(Boolean).join(", ");
}

function mapsUrl(loc: Location | undefined): string | null {
  if (!loc) return null;
  // Delegates to the shared, platform-aware helper (see lib/maps.ts).
  return directionsUrl({
    lat: loc.lat,
    lng: loc.lng,
    address: [loc.address, loc.city, loc.state, loc.zip],
  });
}

function customerName(job: Job): string {
  if (!job.customer) return "Customer";
  const { firstName, lastName, companyName } = job.customer;
  return companyName ?? `${firstName} ${lastName}`;
}

// A live "you're on the clock" chip so a tech always knows what their timer is
// running against, with a one-tap clock-out — right on the agenda they live in.
function ClockChip() {
  const navigate = useNavigate();
  const { data: entry } = useCurrentTimeEntry();
  const clockOut = useClockOut();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!entry) return;
    // Re-render each minute so the elapsed label stays current.
    const id = setInterval(() => {
      setTick((t) => t + 1);
    }, 30000);
    return () => {
      clearInterval(id);
    };
  }, [entry]);

  if (!entry) return null;

  const mins = Math.max(
    0,
    Math.floor((Date.now() - new Date(entry.startTime).getTime()) / 60000),
  );
  const elapsed =
    mins >= 60
      ? `${String(Math.floor(mins / 60))}h ${String(mins % 60)}m`
      : `${String(mins)}m`;
  const job = entry.job;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
      <span className="relative flex h-2.5 w-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-600" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-green-800">
          On the clock · {elapsed}
        </p>
        {job ? (
          <button
            onClick={() => {
              navigate(`/jobs/${job.id}`);
            }}
            className="block max-w-full truncate text-left text-xs text-green-700 underline"
          >
            Work Order #{job.jobNumber} — {job.summary}
          </button>
        ) : (
          <p className="text-xs text-green-700">No work order selected</p>
        )}
      </div>
      <button
        onClick={() => {
          clockOut.mutate();
        }}
        disabled={clockOut.isPending}
        className="shrink-0 inline-flex items-center min-h-[44px] px-3 rounded-lg text-sm font-medium bg-green-600 text-oncolor hover:bg-green-700 disabled:opacity-50"
      >
        Clock out
      </button>
    </div>
  );
}

export default function MyDayPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const today = toDateStr(new Date());
  const [date, setDate] = useState(today);
  const { data: jobs, isLoading, isError, refetch } = useMyDay(date);
  const isToday = date === today;

  // Warm the cache for today's agenda while we still have a connection, so a
  // job's detail + photos are already there if signal drops mid-route. The
  // service worker's NetworkFirst cache (see vite.config.ts) is what actually
  // serves these offline -- this just triggers the real GETs proactively
  // instead of waiting for the tech to open each job one at a time.
  useEffect(() => {
    if (!isToday || !jobs || jobs.length === 0) return;
    if (!onlineManager.isOnline()) return;
    for (const job of jobs) {
      void qc.prefetchQuery({
        queryKey: jobQueryKey(job.id),
        queryFn: () => fetchJob(job.id),
      });
      void qc.prefetchQuery({
        queryKey: attachmentsQueryKey("job", job.id),
        queryFn: () => fetchAttachments("job", job.id),
      });
    }
  }, [isToday, jobs, qc]);

  const shiftDay = (delta: number) => {
    const d = parseDate(date);
    d.setDate(d.getDate() + delta);
    setDate(toDateStr(d));
  };

  const dateLabel = parseDate(date).toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Day selector */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {isToday ? "Today" : dateLabel}
          </h1>
          {isToday && <p className="text-sm text-gray-500">{dateLabel}</p>}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              shiftDay(-1);
            }}
            aria-label="Previous day"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          {!isToday && (
            <button
              onClick={() => {
                setDate(today);
              }}
              className="min-h-[44px] px-3 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Today
            </button>
          )}
          <button
            onClick={() => {
              shiftDay(1);
            }}
            aria-label="Next day"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>
      </div>

      <ClockChip />

      {isLoading ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <TableSkeleton rows={5} />
        </div>
      ) : isError ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <ExclamationTriangleIcon className="h-6 w-6 text-red-500" />
          </div>
          <p className="font-medium text-gray-900">
            Couldn&apos;t load your day
          </p>
          <p className="mt-1 text-sm text-gray-500">
            Check your connection and try again.
          </p>
          <button
            onClick={() => {
              void refetch();
            }}
            className="mt-4 inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-lg text-sm font-medium bg-primary-600 text-oncolor hover:bg-primary-700"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Retry
          </button>
        </div>
      ) : !jobs || jobs.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <EmptyState
            icon={<ClockIcon />}
            title={isToday ? "Nothing scheduled today" : "No work orders this day"}
            description="Assigned work orders will appear here in the order they're scheduled."
          />
        </div>
      ) : (
        <ol className="space-y-3">
          {jobs.map((job, idx) => {
            const url = mapsUrl(job.location);
            const phone = job.customer?.phone;
            return (
              <li
                key={job.id}
                className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden"
              >
                <button
                  onClick={() => {
                    navigate(`/jobs/${job.id}`);
                  }}
                  className="w-full text-left p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center shrink-0">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-xs font-semibold">
                        {idx + 1}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-gray-900">
                          {timeLabel(job.scheduledStart)}
                          {job.scheduledEnd
                            ? ` – ${timeLabel(job.scheduledEnd)}`
                            : ""}
                        </span>
                        <StatusBadge status={job.status} type="job" />
                      </div>
                      <p className="mt-0.5 font-medium text-gray-900 truncate">
                        {customerName(job)}
                      </p>
                      <p className="text-sm text-gray-600 truncate">
                        {job.summary}
                      </p>
                      {addressLine(job.location) && (
                        <p className="mt-0.5 text-xs text-gray-500 flex items-center gap-1">
                          <MapPinIcon className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">
                            {addressLine(job.location)}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                </button>

                {(url ?? phone) && (
                  <div className="flex border-t border-gray-100">
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 text-sm font-medium text-primary-600 hover:bg-primary-50 transition-colors"
                      >
                        <MapPinIcon className="h-4 w-4" />
                        Navigate
                      </a>
                    )}
                    {url && phone && <div className="w-px bg-gray-100" />}
                    {phone && (
                      <button
                        type="button"
                        onClick={() => {
                          void dialOrCopyPhone(phone);
                        }}
                        className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                      >
                        <PhoneIcon className="h-4 w-4" />
                        Call
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
