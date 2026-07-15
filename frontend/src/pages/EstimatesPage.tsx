import { useState } from "react";
import {
  PlusIcon,
  PaperAirplaneIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { useNavigate, Link } from "react-router-dom";
import clsx from "clsx";
import {
  useEstimates,
  useSendEstimate,
  useConvertToInvoice,
} from "../hooks/useEstimates";
import { useLookup } from "../hooks/useMetadata";
import Button from "../components/ui/Button";
import IconButton from "../components/ui/IconButton";
import SearchInput from "../components/ui/SearchInput";
import Pagination from "../components/ui/Pagination";
import { StatusBadge } from "../components/ui/Badge";
import EmptyState from "../components/ui/EmptyState";
import DataTable, { Column, SortState } from "../components/ui/DataTable";
import SavedViewsMenu from "../components/ui/SavedViewsMenu";
import { TableSkeleton } from "../components/ui/Skeleton";
import { formatCurrency, formatDate } from "../utils/formatters";
import type { Estimate } from "../types";

interface EstimatesView {
  search: string;
  status: string;
  sort: SortState | null;
}

function customerName(est: Estimate): string {
  return est.customer
    ? `${est.customer.firstName} ${est.customer.lastName}`
    : "";
}

export default function EstimatesPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortState | null>(null);

  const { options: statusOptions, getLabel: getStatusLabel } =
    useLookup("estimateStatus");
  const statusFilters = ["all", ...statusOptions.map((o) => o.value)];

  const { data, isLoading } = useEstimates({
    page,
    limit: 20,
    search: search || undefined,
    status: status !== "all" ? status : undefined,
  });

  const sendEstimate = useSendEstimate();
  const convertToInvoice = useConvertToInvoice();

  const estimates = data?.data ?? [];
  const pagination = data?.pagination;

  const applyView = (view: EstimatesView) => {
    setSearch(view.search);
    setStatus(view.status);
    setSort(view.sort);
    setPage(1);
  };

  const columns: Column<Estimate>[] = [
    {
      key: "estimate",
      header: "Quote",
      sortValue: (est) => est.estimateNumber,
      exportValue: (est) => est.estimateNumber,
      render: (est) => (
        <span className="font-medium text-primary-600">
          #{est.estimateNumber}
        </span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      sortValue: (est) => customerName(est).toLowerCase(),
      exportValue: (est) => customerName(est),
      render: (est) =>
        est.customer ? (
          <Link
            to={`/customers/${est.customerId}`}
            onClick={(e) => {
              e.stopPropagation();
            }}
            className="text-gray-900 hover:text-primary-600 hover:underline"
          >
            {customerName(est)}
          </Link>
        ) : (
          <span className="text-gray-900">-</span>
        ),
    },
    {
      key: "title",
      header: "Title",
      sortValue: (est) => est.title.toLowerCase(),
      exportValue: (est) => est.title,
      render: (est) => (
        <span className="text-gray-700 truncate max-w-[180px] inline-block align-middle">
          {est.title}
        </span>
      ),
    },
    {
      key: "date",
      header: "Date",
      sortValue: (est) => new Date(est.createdAt).getTime(),
      exportValue: (est) => formatDate(est.createdAt),
      render: (est) => (
        <span className="text-gray-500 text-xs">
          {formatDate(est.createdAt)}
        </span>
      ),
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      sortValue: (est) => est.total,
      exportValue: (est) => est.total,
      render: (est) => (
        <span className="font-medium text-gray-900">
          {formatCurrency(est.total)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (est) => est.status,
      exportValue: (est) => getStatusLabel(est.status),
      render: (est) => <StatusBadge status={est.status} type="estimate" />,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {pagination ? `${String(pagination.total)} quotes` : ""}
        </p>
        <Button
          icon={<PlusIcon className="h-4 w-4" />}
          onClick={() => {
            navigate("/estimates/new");
          }}
        >
          New Quote
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search quotes..."
          className="sm:w-72"
        />
        <div className="flex flex-wrap gap-1 bg-gray-100 rounded-xl p-1">
          {statusFilters.map((s) => (
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
        <div className="sm:ml-auto">
          <SavedViewsMenu<EstimatesView>
            tableId="estimates"
            currentState={{ search, status, sort }}
            onApply={applyView}
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={8} />
        ) : estimates.length === 0 ? (
          <EmptyState
            title="No quotes found"
            action={{
              label: "New Quote",
              onClick: () => {
                navigate("/estimates/new");
              },
            }}
          />
        ) : (
          <>
            <DataTable<Estimate>
              columns={columns}
              rows={estimates}
              getRowId={(est) => est.id}
              onRowClick={(est) => {
                navigate(`/estimates/${est.id}`);
              }}
              sort={sort}
              onSortChange={setSort}
              csvFilename="quotes"
              renderMobileCard={(est) => (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-primary-600">
                      #{est.estimateNumber}
                    </span>
                    <StatusBadge status={est.status} type="estimate" />
                  </div>
                  {est.title && (
                    <p className="text-sm text-gray-700 mt-0.5">{est.title}</p>
                  )}
                  <div className="mt-0.5 flex items-center justify-between text-sm">
                    <span className="text-gray-500">
                      {customerName(est) || "-"}
                    </span>
                    <span className="font-medium text-gray-900">
                      {formatCurrency(est.total)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formatDate(est.createdAt)}
                  </p>
                </div>
              )}
              rowActions={(est) => (
                <>
                  {est.status === "draft" && (
                    <IconButton
                      label="Send quote"
                      onClick={() => {
                        sendEstimate.mutate(est.id);
                      }}
                    >
                      <PaperAirplaneIcon className="h-4 w-4" />
                    </IconButton>
                  )}
                  {est.status === "approved" && (
                    <IconButton
                      label="Convert to invoice"
                      onClick={() => {
                        convertToInvoice.mutate(est.id);
                      }}
                    >
                      <ArrowPathIcon className="h-4 w-4" />
                    </IconButton>
                  )}
                </>
              )}
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
