import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PlusIcon,
  PencilIcon,
  ArchiveBoxIcon,
  ArrowUturnLeftIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useJobs, useArchiveJob, useUnarchiveJob } from "../hooks/useJobs";
import { useLookup } from "../hooks/useMetadata";
import { usePermissions } from "../hooks/usePermissions";
import Button from "../components/ui/Button";
import IconButton from "../components/ui/IconButton";
import SearchInput from "../components/ui/SearchInput";
import Pagination from "../components/ui/Pagination";
import Badge, { StatusBadge } from "../components/ui/Badge";
import EmptyState from "../components/ui/EmptyState";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import DataTable, { Column, SortState } from "../components/ui/DataTable";
import SavedViewsMenu from "../components/ui/SavedViewsMenu";
import { TableSkeleton } from "../components/ui/Skeleton";
import { formatCurrency, formatDateTime } from "../utils/formatters";
import type { Job } from "../types";

interface JobsView {
  search: string;
  status: string;
  sort: SortState | null;
}

function techNames(job: Job): string {
  if (!job.technicians || job.technicians.length === 0) return "";
  return job.technicians
    .map((jt) =>
      jt.technician?.user
        ? `${jt.technician.user.firstName} ${jt.technician.user.lastName}`
        : "",
    )
    .filter(Boolean)
    .join(", ");
}

function customerName(job: Job): string {
  return job.customer
    ? `${job.customer.firstName} ${job.customer.lastName}`
    : "";
}

export default function JobsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortState | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archiveConfirm, setArchiveConfirm] = useState<Job | null>(null);

  const { options: statusOptions, getLabel: getStatusLabel } =
    useLookup("jobStatus");
  const { getLabel: getPriorityLabel, getColor: getPriorityColor } =
    useLookup("jobPriority");
  const { can } = usePermissions();
  const archiveJob = useArchiveJob();
  const unarchiveJob = useUnarchiveJob();
  const statusTabs = ["all", ...statusOptions.map((o) => o.value)];

  const { data, isLoading } = useJobs({
    page,
    limit: 20,
    search: search || undefined,
    status: status !== "all" ? status : undefined,
    archived: showArchived ? "true" : undefined,
    // Sorting has to happen server-side across the whole filtered set, not
    // just the 20 rows on the current page -- DataTable's own sort only ever
    // reorders whatever `rows` it's given.
    sortKey: sort?.key,
    sortDir: sort?.dir,
  });

  const jobs = data?.data ?? [];
  const pagination = data?.pagination;

  const resetPage = () => {
    setPage(1);
  };

  const applyView = (view: JobsView) => {
    setSearch(view.search);
    setStatus(view.status);
    setSort(view.sort);
    resetPage();
  };

  const columns: Column<Job>[] = [
    {
      key: "job",
      header: "Work Order",
      sortValue: (j) => j.jobNumber,
      exportValue: (j) => j.jobNumber,
      render: (j) => (
        <div>
          <span className="font-semibold text-primary-600">#{j.jobNumber}</span>
          <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[150px]">
            {j.summary}
          </p>
        </div>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      sortValue: (j) => customerName(j).toLowerCase(),
      exportValue: (j) => customerName(j),
      render: (j) => (
        <span className="text-gray-900">{customerName(j) || "-"}</span>
      ),
    },
    {
      key: "type",
      header: "Type",
      sortValue: (j) => j.type,
      exportValue: (j) => j.type,
      render: (j) => (
        <span className="capitalize text-gray-600 text-xs">{j.type}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (j) => j.status,
      exportValue: (j) => getStatusLabel(j.status),
      render: (j) => (
        <span className="inline-flex items-center gap-1.5">
          <StatusBadge status={j.status} type="job" />
          {j.isArchived && (
            <Badge className="bg-gray-100 text-gray-500">Archived</Badge>
          )}
        </span>
      ),
    },
    {
      key: "priority",
      header: "Priority",
      sortValue: (j) => j.priority,
      exportValue: (j) => getPriorityLabel(j.priority),
      render: (j) => (
        <span
          className={clsx(
            "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize",
            getPriorityColor(j.priority),
          )}
        >
          {getPriorityLabel(j.priority)}
        </span>
      ),
    },
    {
      key: "scheduled",
      header: "Scheduled",
      sortValue: (j) =>
        j.scheduledStart ? new Date(j.scheduledStart).getTime() : 0,
      exportValue: (j) =>
        j.scheduledStart ? formatDateTime(j.scheduledStart) : "",
      render: (j) => (
        <span className="text-gray-500 text-xs">
          {j.scheduledStart ? formatDateTime(j.scheduledStart) : "-"}
        </span>
      ),
    },
    {
      key: "technicians",
      header: "Technicians",
      exportValue: (j) => techNames(j),
      render: (j) => {
        const names = techNames(j);
        return names ? (
          <span className="text-gray-600 text-xs">{names}</span>
        ) : (
          <span className="text-gray-400 text-xs">Unassigned</span>
        );
      },
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      sortValue: (j) => j.totalAmount,
      exportValue: (j) => j.totalAmount,
      render: (j) => (
        <span className="font-medium text-gray-900">
          {formatCurrency(j.totalAmount)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {pagination ? `${String(pagination.total)} work orders` : ""}
        </p>
        {can("jobs.create") && (
          <Button
            icon={<PlusIcon className="h-4 w-4" />}
            onClick={() => {
              navigate("/jobs/new");
            }}
          >
            New Work Order
          </Button>
        )}
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 flex-wrap">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 flex-wrap">
          {statusTabs.map((s) => (
            <button
              key={s}
              onClick={() => {
                setStatus(s);
                resetPage();
              }}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors",
                status === s
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700",
              )}
            >
              {s === "all" ? "All" : getStatusLabel(s)}
            </button>
          ))}
        </div>
      </div>

      {/* Search + saved views */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            resetPage();
          }}
          placeholder="Search work orders..."
          className="w-full sm:w-72"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => {
              setShowArchived(e.target.checked);
              resetPage();
            }}
            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          Show archived
        </label>
        <div className="sm:ml-auto">
          <SavedViewsMenu<JobsView>
            tableId="jobs"
            currentState={{ search, status, sort }}
            onApply={applyView}
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={8} />
        ) : jobs.length === 0 ? (
          <EmptyState
            title="No work orders found"
            description="Create your first work order to get started"
            action={
              can("jobs.create")
                ? {
                    label: "New Work Order",
                    onClick: () => {
                      navigate("/jobs/new");
                    },
                  }
                : undefined
            }
          />
        ) : (
          <>
            {pagination && (
              <div className="px-5 py-4 border-b border-gray-100">
                <Pagination
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  onPageChange={setPage}
                />
              </div>
            )}
            <DataTable<Job>
              columns={columns}
              rows={jobs}
              getRowId={(j) => j.id}
              onRowClick={(j) => {
                navigate(`/jobs/${j.id}`);
              }}
              sort={sort}
              onSortChange={setSort}
              csvFilename="jobs"
              renderMobileCard={(j) => (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-primary-600">
                      #{j.jobNumber}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <StatusBadge status={j.status} type="job" />
                      {j.isArchived && (
                        <Badge className="bg-gray-100 text-gray-500">
                          Archived
                        </Badge>
                      )}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 mt-0.5">{j.summary}</p>
                  <div className="mt-1.5 text-sm text-gray-600 space-y-0.5">
                    {customerName(j) && <p>{customerName(j)}</p>}
                    {j.scheduledStart && (
                      <p className="text-xs text-gray-500">
                        {formatDateTime(j.scheduledStart)}
                      </p>
                    )}
                    <p className="text-xs text-gray-500">
                      {techNames(j) || "Unassigned"}
                    </p>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <span
                      className={clsx(
                        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize",
                        getPriorityColor(j.priority),
                      )}
                    >
                      {getPriorityLabel(j.priority)}
                    </span>
                    <span className="font-medium text-gray-900 text-sm">
                      {formatCurrency(j.totalAmount)}
                    </span>
                  </div>
                </div>
              )}
              rowActions={(j) => (
                <>
                  {can("jobs.edit") && (
                    <IconButton
                      label="Edit job"
                      onClick={() => {
                        navigate(`/jobs/${j.id}/edit`);
                      }}
                    >
                      <PencilIcon className="h-4 w-4" />
                    </IconButton>
                  )}
                  {can("jobs.delete") &&
                    (j.isArchived ? (
                      <IconButton
                        label="Restore job"
                        onClick={() => {
                          unarchiveJob.mutate(j.id);
                        }}
                      >
                        <ArrowUturnLeftIcon className="h-4 w-4" />
                      </IconButton>
                    ) : (
                      <IconButton
                        label="Archive job"
                        onClick={() => {
                          setArchiveConfirm(j);
                        }}
                      >
                        <ArchiveBoxIcon className="h-4 w-4" />
                      </IconButton>
                    ))}
                </>
              )}
            />

            <ConfirmDialog
              isOpen={!!archiveConfirm}
              onClose={() => {
                setArchiveConfirm(null);
              }}
              onConfirm={() => {
                if (!archiveConfirm) return;
                archiveJob.mutate(archiveConfirm.id, {
                  onSuccess: () => {
                    setArchiveConfirm(null);
                  },
                });
              }}
              title="Archive job"
              message={`Archive job #${archiveConfirm?.jobNumber ?? ""}? It's hidden from active lists and the dispatch board, but nothing is deleted -- you can restore it anytime.`}
              confirmLabel="Archive"
              loading={archiveJob.isPending}
            />
            {pagination && (
              <div className="px-5 py-4 border-t border-gray-100">
                <Pagination
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  onPageChange={setPage}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
