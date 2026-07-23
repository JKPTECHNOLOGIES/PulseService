import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { MapPinIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { MapPinIcon as MapPinIconSolid } from "@heroicons/react/24/solid";
import clsx from "clsx";
import Badge from "./Badge";
import Button from "./Button";
import Spinner from "./Spinner";
import {
  useTimeline,
  useCreateNote,
  useSetNotePinned,
} from "../../hooks/useTimeline";
import { formatDate } from "../../utils/formatters";
import type { TimelineItem, TimelineEventItem } from "../../types";

const ENTITY_META: Record<
  TimelineEventItem["entityType"],
  { label: string; color: string; path: (id: string) => string }
> = {
  job: {
    label: "Work Order",
    color: "bg-blue-100 text-blue-700",
    path: (id) => `/jobs/${id}`,
  },
  invoice: {
    label: "Invoice",
    color: "bg-purple-100 text-purple-700",
    path: (id) => `/invoices/${id}`,
  },
  estimate: {
    label: "Quote",
    color: "bg-amber-100 text-amber-700",
    path: (id) => `/estimates/${id}`,
  },
};

function timeOf(iso: string): string {
  try {
    return format(parseISO(iso), "h:mm a");
  } catch {
    return "";
  }
}

interface TimelineProps {
  customerId: string;
}

/**
 * The merged Work Order + Invoice + Quote timeline for one customer: a note
 * composer, any pinned notes, and a date-grouped chronological feed of
 * manually-written notes plus narrated system events (status changes,
 * technician assignment, sends, payments, ...), each labeled by which kind of
 * record it came from and linking straight to it.
 */
export default function Timeline({ customerId }: TimelineProps) {
  const [page, setPage] = useState(1);
  const [accumulated, setAccumulated] = useState<TimelineItem[]>([]);
  const [noteBody, setNoteBody] = useState("");

  const { data, isLoading, isFetching } = useTimeline(customerId, page);
  const createNote = useCreateNote();
  const setPinned = useSetNotePinned();

  useEffect(() => {
    setPage(1);
    setAccumulated([]);
  }, [customerId]);

  useEffect(() => {
    if (!data) return;
    setAccumulated((prev) => {
      if (page === 1) return data.data;
      const seen = new Set(prev.map((i) => i.id));
      return [...prev, ...data.data.filter((i) => !seen.has(i.id))];
    });
  }, [data, page]);

  const pinned = data?.pinned ?? [];
  const pagination = data?.pagination;
  const canShowMore = pagination ? pagination.page < pagination.totalPages : false;

  const saveNote = () => {
    const body = noteBody.trim();
    if (!body) return;
    createNote.mutate(
      { customerId, body },
      {
        onSuccess: () => {
          setNoteBody("");
          setPage(1);
        },
      },
    );
  };

  // Group the accumulated feed by calendar day, preserving the newest-first
  // order the API already returns.
  const groups: { label: string; items: TimelineItem[] }[] = [];
  for (const item of accumulated) {
    const label = formatDate(item.createdAt);
    if (groups.length > 0 && groups[groups.length - 1].label === label) {
      groups[groups.length - 1].items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h3 className="font-semibold text-gray-900 mb-4">Timeline</h3>

      {/* Note composer */}
      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <input
          type="text"
          value={noteBody}
          onChange={(e) => {
            setNoteBody(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveNote();
          }}
          placeholder="Type Here"
          className="flex-1 px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:bg-white"
        />
        <Button
          size="sm"
          loading={createNote.isPending}
          disabled={!noteBody.trim()}
          onClick={saveNote}
        >
          Save Note
        </Button>
      </div>

      {/* Pinned notes always show above the chronological feed */}
      {pinned.length > 0 && (
        <div className="space-y-2 mb-5">
          {pinned.map((n) =>
            n.kind === "note" ? (
              <div
                key={n.id}
                className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-100 p-3"
              >
                <MapPinIconSolid className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <span className="inline-block mb-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
                    Pinned note
                  </span>
                  <p className="text-sm text-gray-700 whitespace-pre-line">
                    {n.body}
                  </p>
                </div>
                <button
                  type="button"
                  title="Unpin note"
                  onClick={() => {
                    setPinned.mutate({ id: n.id, pinned: false, customerId });
                  }}
                  className="shrink-0 text-gray-400 hover:text-gray-600"
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </div>
            ) : null,
          )}
        </div>
      )}

      {/* Date-grouped feed */}
      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner className="h-6 w-6 text-primary-600" />
        </div>
      ) : accumulated.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">
          Nothing here yet -- notes and changes to this customer's work
          orders, invoices, and quotes will show up here.
        </p>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="text-xs font-medium text-gray-400 mb-3">
                {group.label}
              </p>
              <div className="space-y-4 border-l-2 border-gray-100 pl-4 ml-1.5">
                {group.items.map((item) => (
                  <div key={item.id} className="relative">
                    <span
                      className={clsx(
                        "absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full ring-4 ring-white",
                        item.kind === "note" ? "bg-gray-400" : "bg-primary-500",
                      )}
                    />
                    <div className="flex items-center gap-2 flex-wrap text-xs text-gray-400">
                      {item.kind === "note" ? (
                        <Badge className="bg-gray-100 text-gray-600">
                          Note
                        </Badge>
                      ) : (
                        <Badge className={ENTITY_META[item.entityType].color}>
                          {ENTITY_META[item.entityType].label}
                        </Badge>
                      )}
                      <span>
                        {item.user?.name ?? "System"} · {timeOf(item.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 mt-1">
                      {item.kind === "note" ? (
                        item.body
                      ) : (
                        <>
                          {item.description}{" "}
                          <Link
                            to={ENTITY_META[item.entityType].path(item.entityId)}
                            className="text-primary-600 hover:text-primary-700 font-medium"
                          >
                            #{item.entityLabel}
                          </Link>
                        </>
                      )}
                    </p>
                    {item.kind === "note" && (
                      <button
                        type="button"
                        onClick={() => {
                          setPinned.mutate({
                            id: item.id,
                            pinned: true,
                            customerId,
                          });
                        }}
                        className="mt-1 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-primary-600"
                      >
                        <MapPinIcon className="h-3.5 w-3.5" />
                        Pin note
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {canShowMore && (
        <div className="flex justify-center mt-5">
          <Button
            variant="outline"
            size="sm"
            loading={isFetching && page > 1}
            onClick={() => {
              setPage((p) => p + 1);
            }}
          >
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}
