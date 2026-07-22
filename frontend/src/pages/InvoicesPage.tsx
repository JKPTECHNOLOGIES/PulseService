import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PlusIcon,
  PaperAirplaneIcon,
  InformationCircleIcon,
} from "@heroicons/react/24/outline";
import { Popover } from "@headlessui/react";
import clsx from "clsx";
import { useInvoices, useInvoiceStats } from "../hooks/useInvoices";
import Button from "../components/ui/Button";
import IconButton from "../components/ui/IconButton";
import SearchInput from "../components/ui/SearchInput";
import Pagination from "../components/ui/Pagination";
import { StatusBadge } from "../components/ui/Badge";
import EmptyState from "../components/ui/EmptyState";
import DataTable, { Column, SortState } from "../components/ui/DataTable";
import SavedViewsMenu from "../components/ui/SavedViewsMenu";
import SendInvoiceModal from "../components/ui/SendInvoiceModal";
import { TableSkeleton } from "../components/ui/Skeleton";
import {
  formatCurrency,
  formatDate,
  statusDotColor,
  getInvoiceStatusColor,
} from "../utils/formatters";
import { useLookup } from "../hooks/useMetadata";
import type { Invoice } from "../types";

interface InvoicesView {
  search: string;
  status: string;
  sort: SortState | null;
}

function customerName(inv: Invoice): string {
  if (!inv.customer) return "";
  const { firstName, lastName, companyName } = inv.customer;
  if (companyName?.trim()) return companyName;
  return `${firstName} ${lastName}`.trim();
}

export default function InvoicesPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortState | null>(null);
  const [sendInvoiceId, setSendInvoiceId] = useState<string | null>(null);
  const { options: statusOptions } = useLookup("invoiceStatus");

  const { data, isLoading } = useInvoices({
    page,
    limit: 20,
    search: search || undefined,
    status: status !== "all" ? status : undefined,
  });
  const { data: stats } = useInvoiceStats();

  const invoices = data?.data ?? [];
  const pagination = data?.pagination;
  const summary = data?.summary;
  const invoiceToSend = invoices.find((inv) => inv.id === sendInvoiceId) ?? null;

  // Category tabs mirror the office's mental model: All + one per status, with
  // live counts. "overdue" is shown as "Past Due" to match familiar wording.
  // "viewed" and "void" are hidden here to keep the bar short -- they're rare
  // in practice and still reachable via All + the status color/legend; the
  // color dot still shows on any invoice actually in one of those states.
  const HIDDEN_STATUS_TABS = new Set(["viewed", "void"]);
  const tabs = [
    { value: "all", label: "All", count: stats?.total },
    ...statusOptions
      .filter((o) => !HIDDEN_STATUS_TABS.has(o.value))
      .map((o) => ({
        value: o.value,
        label: o.value === "overdue" ? "Past Due" : o.label,
        count: stats ? (stats.byStatus[o.value] ?? 0) : undefined,
      })),
  ];

  const applyView = (view: InvoicesView) => {
    setSearch(view.search);
    setStatus(view.status);
    setSort(view.sort);
    setPage(1);
  };

  // Solid dot color for an invoice's pay status, replacing the old dedicated
  // "Pay Status" column (see legend rendered above the table).
  const statusDot = (invoiceStatus: string) => {
    const opt = statusOptions.find((o) => o.value === invoiceStatus);
    return statusDotColor(opt?.color ?? getInvoiceStatusColor(invoiceStatus));
  };

  const columns: Column<Invoice>[] = [
    {
      key: "invoice",
      header: "Invoice #",
      thClassName: "w-[8%]",
      sortValue: (inv) => inv.invoiceNumber,
      exportValue: (inv) => inv.invoiceNumber,
      render: (inv) => (
        <span className="inline-flex items-center gap-2">
          <span
            className={clsx(
              "h-2.5 w-2.5 rounded-full shrink-0",
              statusDot(inv.status),
            )}
            title={
              statusOptions.find((o) => o.value === inv.status)?.label ??
              inv.status
            }
          />
          <span className="font-medium text-primary-600">
            #{inv.invoiceNumber}
          </span>
        </span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      thClassName: "w-[13%]",
      sortValue: (inv) => customerName(inv).toLowerCase(),
      exportValue: (inv) => customerName(inv),
      render: (inv) => (
        <span
          className="block truncate text-gray-900"
          title={customerName(inv) || undefined}
        >
          {customerName(inv) || "-"}
        </span>
      ),
    },
    {
      key: "workOrder",
      header: "Work Order",
      thClassName: "w-[40%]",
      sortValue: (inv) => inv.job?.jobNumber ?? "",
      exportValue: (inv) =>
        inv.job ? `#${inv.job.jobNumber} ${inv.job.summary ?? ""}`.trim() : "",
      render: (inv) =>
        inv.job ? (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700">
                #{inv.job.jobNumber}
              </span>
              {inv.job.status && (
                <StatusBadge status={inv.job.status} type="job" />
              )}
            </div>
            {inv.job.summary && (
              <p className="text-sm text-gray-500 line-clamp-2 mt-0.5">
                {inv.job.summary}
              </p>
            )}
          </div>
        ) : (
          <span className="text-gray-300">-</span>
        ),
    },
    {
      key: "date",
      header: "Date",
      thClassName: "w-[8%]",
      sortValue: (inv) => new Date(inv.createdAt).getTime(),
      exportValue: (inv) => formatDate(inv.createdAt),
      render: (inv) => (
        <span className="text-gray-500 text-xs whitespace-nowrap">
          {formatDate(inv.createdAt)}
        </span>
      ),
    },
    {
      key: "dueDate",
      header: "Due Date",
      thClassName: "w-[8%]",
      sortValue: (inv) => (inv.dueDate ? new Date(inv.dueDate).getTime() : 0),
      exportValue: (inv) => (inv.dueDate ? formatDate(inv.dueDate) : ""),
      render: (inv) => (
        <span className="text-gray-500 text-xs whitespace-nowrap">
          {formatDate(inv.dueDate)}
        </span>
      ),
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      thClassName: "w-[11%]",
      sortValue: (inv) => inv.total,
      exportValue: (inv) => inv.total,
      render: (inv) => (
        <span className="font-medium text-gray-900 whitespace-nowrap">
          {formatCurrency(inv.total)}
        </span>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      thClassName: "w-[11%]",
      sortValue: (inv) => inv.balance,
      exportValue: (inv) => inv.balance,
      render: (inv) => (
        <span
          className={clsx(
            "font-medium whitespace-nowrap",
            inv.balance > 0 ? "text-red-600" : "text-green-600",
          )}
        >
          {formatCurrency(inv.balance)}
        </span>
      ),
    },
    {
      // Visually replaced by the color-coded dot on the Invoice # column plus
      // the legend above the table, but kept in CSV exports since color
      // doesn't survive into a spreadsheet.
      key: "status",
      header: "Pay Status",
      exportOnly: true,
      exportValue: (inv) => inv.status,
      render: () => null,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {stats ? `${String(stats.total)} invoices` : ""}
        </p>
        <Button
          icon={<PlusIcon className="h-4 w-4" />}
          onClick={() => {
            navigate("/invoices/new");
          }}
        >
          New Invoice
        </Button>
      </div>

      {/* Search + saved views */}
      <div className="flex flex-col sm:flex-row gap-3">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search by customer, invoice #, or work order…"
          className="sm:w-96"
        />
        <div className="sm:ml-auto">
          <SavedViewsMenu<InvoicesView>
            tableId="invoices"
            currentState={{ search, status, sort }}
            onApply={applyView}
          />
        </div>
      </div>

      {/* Category tabs + status color legend (replaces the old dedicated
          "Pay Status" column — each invoice's row is color-coded via the dot
          next to its number instead; this popover explains what each color
          means without permanently occupying page space). */}
      <div className="flex items-end justify-between gap-3 border-b border-gray-200">
        <div className="overflow-x-auto">
          <div className="flex min-w-max">
            {tabs.map((t) => (
              <button
                key={t.value}
                onClick={() => {
                  setStatus(t.value);
                  setPage(1);
                }}
                className={clsx(
                  "relative px-3.5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors",
                  status === t.value
                    ? "border-primary-600 text-primary-700"
                    : "border-transparent text-gray-500 hover:text-gray-700",
                )}
              >
                {t.label}
                {typeof t.count === "number" && (
                  <span
                    className={clsx(
                      "ml-1.5 rounded-full px-1.5 py-0.5 text-xs font-semibold",
                      status === t.value
                        ? "bg-primary-100 text-primary-700"
                        : "bg-gray-100 text-gray-500",
                    )}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <Popover className="relative mb-1.5 shrink-0">
          <Popover.Button className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700">
            <InformationCircleIcon className="h-4 w-4" />
            Status colors
          </Popover.Button>
          <Popover.Panel className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-gray-100 bg-white py-2 shadow-lg">
            {statusOptions.map((o) => (
              <div
                key={o.value}
                className="flex items-center gap-2 px-3 py-1 text-sm text-gray-600"
              >
                <span
                  className={clsx(
                    "h-2.5 w-2.5 rounded-full shrink-0",
                    statusDotColor(o.color ?? ""),
                  )}
                />
                {o.value === "overdue" ? "Past Due" : o.label}
              </div>
            ))}
          </Popover.Panel>
        </Popover>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={8} />
        ) : invoices.length === 0 ? (
          <EmptyState
            title="No invoices found"
            action={{
              label: "New Invoice",
              onClick: () => {
                navigate("/invoices/new");
              },
            }}
          />
        ) : (
          <>
            <DataTable<Invoice>
              columns={columns}
              rows={invoices}
              getRowId={(inv) => inv.id}
              onRowClick={(inv) => {
                navigate(`/invoices/${inv.id}`);
              }}
              sort={sort}
              onSortChange={setSort}
              tableLayout="fixed"
              csvFilename="invoices"
              renderMobileCard={(inv) => (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-primary-600">
                      #{inv.invoiceNumber}
                    </span>
                    <StatusBadge status={inv.status} type="invoice" />
                  </div>
                  {customerName(inv) && (
                    <p className="text-sm text-gray-700 mt-0.5">
                      {customerName(inv)}
                    </p>
                  )}
                  {inv.job && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      WO #{inv.job.jobNumber}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-0.5">
                    Due {formatDate(inv.dueDate)}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between text-sm">
                    <span className="text-gray-500">
                      {formatCurrency(inv.total)}
                    </span>
                    <span
                      className={clsx(
                        "font-medium",
                        inv.balance > 0 ? "text-red-600" : "text-green-600",
                      )}
                    >
                      Bal {formatCurrency(inv.balance)}
                    </span>
                  </div>
                </div>
              )}
              rowActions={(inv) =>
                inv.status === "draft" ? (
                  <IconButton
                    label="Send invoice"
                    onClick={() => {
                      setSendInvoiceId(inv.id);
                    }}
                  >
                    <PaperAirplaneIcon className="h-4 w-4" />
                  </IconButton>
                ) : null
              }
            />

            {/* Grand totals for the whole filtered set (all pages) */}
            {summary && (
              <div className="flex items-center justify-between gap-4 px-5 py-3 border-t border-gray-200 bg-gray-50 text-sm">
                <span className="font-semibold text-gray-700">
                  Grand Totals
                </span>
                <div className="flex gap-8">
                  <span className="text-gray-500">
                    Total{" "}
                    <span className="font-semibold text-gray-900">
                      {formatCurrency(summary.total)}
                    </span>
                  </span>
                  <span className="text-gray-500">
                    Balance{" "}
                    <span className="font-semibold text-gray-900">
                      {formatCurrency(summary.balance)}
                    </span>
                  </span>
                </div>
              </div>
            )}

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

      {invoiceToSend && (
        <SendInvoiceModal
          isOpen={!!sendInvoiceId}
          invoice={invoiceToSend}
          onClose={() => {
            setSendInvoiceId(null);
          }}
        />
      )}
    </div>
  );
}
