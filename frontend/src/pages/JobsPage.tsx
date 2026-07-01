import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlusIcon, PencilIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useJobs } from "../hooks/useJobs";
import { useLookup } from "../hooks/useMetadata";
import Button from "../components/ui/Button";
import SearchInput from "../components/ui/SearchInput";
import Pagination from "../components/ui/Pagination";
import { StatusBadge } from "../components/ui/Badge";
import EmptyState from "../components/ui/EmptyState";
import { PageSpinner } from "../components/ui/Spinner";
import { formatCurrency, formatDateTime } from "../utils/formatters";

export default function JobsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const { options: statusOptions, getLabel: getStatusLabel } =
    useLookup("jobStatus");
  const { getLabel: getPriorityLabel, getColor: getPriorityColor } =
    useLookup("jobPriority");
  const statusTabs = ["all", ...statusOptions.map((o) => o.value)];

  const { data, isLoading } = useJobs({
    page,
    limit: 20,
    search: search || undefined,
    status: status !== "all" ? status : undefined,
  });

  const jobs = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {pagination ? `${String(pagination.total)} jobs` : ""}
        </p>
        <Button
          icon={<PlusIcon className="h-4 w-4" />}
          onClick={() => {
            navigate("/jobs/new");
          }}
        >
          New Job
        </Button>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 flex-wrap">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 flex-wrap">
          {statusTabs.map((s) => (
            <button
              key={s}
              onClick={() => {
                setStatus(s);
                setPage(1);
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

      {/* Search */}
      <SearchInput
        value={search}
        onChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        placeholder="Search jobs..."
        className="w-full sm:w-72"
      />

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <PageSpinner />
        ) : jobs.length === 0 ? (
          <EmptyState
            title="No jobs found"
            description="Create your first job to get started"
            action={{
              label: "New Job",
              onClick: () => {
                navigate("/jobs/new");
              },
            }}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs uppercase">
                      Job
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Customer
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Type
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Status
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Priority
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Scheduled
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Technicians
                    </th>
                    <th className="text-right py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Amount
                    </th>
                    <th className="text-right py-3 px-5 font-medium text-gray-500 text-xs uppercase">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      onClick={() => {
                        navigate(`/jobs/${job.id}`);
                      }}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      <td className="py-3.5 px-5">
                        <span className="font-semibold text-primary-600">
                          #{job.jobNumber}
                        </span>
                        <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[150px]">
                          {job.summary}
                        </p>
                      </td>
                      <td className="py-3.5 px-3 text-gray-900">
                        {job.customer
                          ? `${job.customer.firstName} ${job.customer.lastName}`
                          : "-"}
                      </td>
                      <td className="py-3.5 px-3">
                        <span className="capitalize text-gray-600 text-xs">
                          {job.type}
                        </span>
                      </td>
                      <td className="py-3.5 px-3">
                        <StatusBadge status={job.status} type="job" />
                      </td>
                      <td className="py-3.5 px-3">
                        <span
                          className={clsx(
                            "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize",
                            getPriorityColor(job.priority),
                          )}
                        >
                          {getPriorityLabel(job.priority)}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-gray-500 text-xs">
                        {formatDateTime(job.scheduledStart)}
                      </td>
                      <td className="py-3.5 px-3 text-gray-600 text-xs">
                        {job.technicians && job.technicians.length > 0 ? (
                          job.technicians
                            .map((jt) =>
                              jt.technician?.user
                                ? `${jt.technician.user.firstName} ${jt.technician.user.lastName}`
                                : "-",
                            )
                            .join(", ")
                        ) : (
                          <span className="text-gray-400">Unassigned</span>
                        )}
                      </td>
                      <td className="py-3.5 px-3 text-right font-medium text-gray-900">
                        {formatCurrency(job.totalAmount)}
                      </td>
                      <td className="py-3.5 px-5">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/jobs/${job.id}/edit`);
                            }}
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                          >
                            <PencilIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
