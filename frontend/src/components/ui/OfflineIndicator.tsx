import { useEffect, useState } from "react";
import {
  onlineManager,
  useMutationState,
  useQueryClient,
} from "@tanstack/react-query";
import {
  CloudArrowUpIcon,
  SignalSlashIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ArrowPathIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import { usePendingUploads } from "../../hooks/useOfflineUploads";
import {
  drainUploadQueue,
  removePendingUpload,
  retryPendingUpload,
} from "../../lib/offlineUploads";
import { getErrorMessage } from "../../lib/errors";
import toast from "../../lib/toast";

// Keyed offline mutations are registered in lib/offlineMutations.ts as
// ["offline", "<slug>"]; this maps the slug to what a technician actually
// calls the action, so the drawer reads like a todo list, not a debug log.
const MUTATION_LABELS: Record<string, string> = {
  "clock-in": "Clock in",
  "clock-out": "Clock out",
  "issue-to-job": "Part issued",
  "update-job-status": "Status update",
  "install-serialized-unit": "Unit installed",
  "uninstall-serialized-unit": "Unit removed",
  "reverse-transaction": "Part removed",
  "update-job": "Job details updated",
  "create-job": "New job",
};

function mutationLabel(mutationKey: readonly unknown[] | undefined): string {
  const slug = mutationKey?.[1];
  if (typeof slug === "string") return MUTATION_LABELS[slug] ?? slug;
  return "Change";
}

/**
 * Small floating status pill. Appears only when the app is offline or there
 * are mutations/uploads waiting to sync. Tapping it expands an itemized list
 * of what's pending, with retry/discard for anything that failed -- so a
 * tech never has to just trust that "it probably went through."
 */
export default function OfflineIndicator() {
  const [online, setOnline] = useState(onlineManager.isOnline());
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();

  useEffect(() => onlineManager.subscribe(setOnline), []);

  // Paused = still waiting for connectivity (resumes automatically). Errored
  // = actually attempted and rejected (e.g. a validation error) -- these
  // don't auto-retry, so they need a visible dismiss action instead of
  // silently disappearing.
  const mutations = useMutationState({
    filters: { predicate: (m) => m.state.isPaused || m.state.status === "error" },
    select: (mutation) => mutation,
  });

  const uploads = usePendingUploads();

  type Entry =
    | {
        kind: "mutation";
        key: string;
        label: string;
        status: "queued" | "failed";
        error?: string;
        mutation: (typeof mutations)[number];
      }
    | {
        kind: "upload";
        key: string;
        label: string;
        status: "queued" | "failed";
        error?: string;
        uploadId: string;
      };

  const entries: Entry[] = [
    ...mutations.map(
      (m): Entry => ({
        kind: "mutation",
        key: `m-${String(m.mutationId)}`,
        label: mutationLabel(m.options.mutationKey),
        status: m.state.isPaused ? "queued" : "failed",
        error:
          m.state.status === "error"
            ? getErrorMessage(m.state.error, "Failed")
            : undefined,
        mutation: m,
      }),
    ),
    ...uploads.map(
      (u): Entry => ({
        kind: "upload",
        key: `u-${u.id}`,
        label: u.caption === "Signature" ? "Signature" : "Photo",
        status: u.status === "error" ? "failed" : "queued",
        error: u.error,
        uploadId: u.id,
      }),
    ),
  ];

  const totalPending = entries.length;
  if (online && totalPending === 0) return null;

  const retryUpload = (uploadId: string) => {
    if (!onlineManager.isOnline()) {
      toast.error("Still offline — will retry automatically once reconnected");
      return;
    }
    void retryPendingUpload(uploadId).then(() => drainUploadQueue(qc));
  };

  return (
    <div className="fixed bottom-20 md:bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {expanded && entries.length > 0 && (
        <div className="max-h-72 w-80 max-w-[90vw] overflow-y-auto rounded-xl border border-gray-100 bg-white p-2 text-sm shadow-xl">
          {entries.map((entry) => (
            <div
              key={entry.key}
              className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-800">
                  {entry.label}
                </p>
                <p
                  className={clsx(
                    "truncate text-xs",
                    entry.status === "failed" ? "text-red-500" : "text-gray-400",
                  )}
                >
                  {entry.status === "failed"
                    ? (entry.error ?? "Failed to sync")
                    : "Queued"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {entry.kind === "upload" && entry.status === "failed" && (
                  <button
                    type="button"
                    title="Retry"
                    aria-label="Retry"
                    onClick={() => {
                      retryUpload(entry.uploadId);
                    }}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-primary-50 hover:text-primary-600"
                  >
                    <ArrowPathIcon className="h-4 w-4" />
                  </button>
                )}
                {entry.kind === "upload" && (
                  <button
                    type="button"
                    title="Discard"
                    aria-label="Discard"
                    onClick={() => {
                      void removePendingUpload(entry.uploadId);
                    }}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                )}
                {entry.kind === "mutation" && entry.status === "failed" && (
                  <button
                    type="button"
                    title="Dismiss"
                    aria-label="Dismiss"
                    onClick={() => {
                      qc.getMutationCache().remove(entry.mutation);
                    }}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                  >
                    <XMarkIcon className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          setExpanded((v) => !v);
        }}
        className={clsx(
          // Sits above the mobile bottom tab bar; lower on desktop where there is none.
          "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium shadow-lg",
          online ? "bg-primary-600 text-oncolor" : "bg-gray-800 text-oncolor",
        )}
      >
        {online ? (
          <CloudArrowUpIcon className="h-4 w-4" />
        ) : (
          <SignalSlashIcon className="h-4 w-4" />
        )}
        {online
          ? `Syncing${totalPending > 0 ? ` · ${String(totalPending)} pending` : ""}`
          : `Offline${totalPending > 0 ? ` · ${String(totalPending)} pending sync` : ""}`}
        {totalPending > 0 &&
          (expanded ? (
            <ChevronDownIcon className="h-3.5 w-3.5" />
          ) : (
            <ChevronUpIcon className="h-3.5 w-3.5" />
          ))}
      </button>
    </div>
  );
}
