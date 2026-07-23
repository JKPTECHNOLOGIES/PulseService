import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlusIcon, PaperAirplaneIcon } from "@heroicons/react/24/outline";
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
import { formatCurrency, formatDate } from "../utils/formatters";
import { useLookup } from "../hooks/useMetadata";
import type { Invoice } from "../types";

interface InvoicesView {
  search: string;
  status: string;
  sort: SortState | null;
  letter: string | null;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

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
  const [letter, setLetter] = useState<string | null>(null);
  const [sendInvoiceId, setSendInvoiceId] = useState<string | null>(null);
  const { options: statusOptions } = useLookup("invoiceStatus");

  const { data, isLoading } = useInvoices({
    page,
    limit: 20,
    search: search || undefined,
    status: status !== "all" ? status : undefined,
    letter: letter ?? undefined,
  });
  const { data: stats } = useInvoiceStats();

  const invoices = data?.data ?? [];
  const pagination = data?.pagination;
  const summary = data?.summary;
  const invoiceToSend = invoices.find((inv) => inv.id === sendInvoiceId) ?? null;

  // Category tabs mirror the office's mental model: All + one per status, with
  // live counts. "overdue" is shown as "Past Due" to match familiar wording.
  // "viewed" and "void" are hidden here to keep the bar short -- they're rare
  // in practice and still reachable via All + the "Invoice Pay Status" column.
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
    setLetter(view.letter);
    setPage(1);
  };

  // A-Z index: filters to invoices whose customer's displayed name (company
  // name if on file, else first name -- matches the Customer column) starts
  // with the selected letter. Clicking the same letter again clears it.
  const selectLetter = (l: string) => {
    setLetter((current) => (current === l ? null : l));
    setSearch("");
    setPage(1);
  };

  // Column order mirrors the office's reference layout left to right:
  // Customer, WO #, Invoice #, Date, Due Date, Total, Balance, Invoice Pay
  // Status, WO Description, Summary.
  const columns: Column<Invoice>[] = [
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
      key: "workOrderNumber",
      header: "WO #",
      thClassName: "w-[7%]",
      sortValue: (inv) => inv.job?.jobNumber ?? "",
      exportValue: (inv) => (inv.job ? `#${inv.job.jobNumber}` : ""),
      render: (inv) =>
        inv.job ? (
          <span className="font-medium text-gray-700 whitespace-nowrap">
            #{inv.job.jobNumber}
          </span>
        ) : (
          <span className="text-gray-300">-</span>
        ),
    },
    {
      key: "invoice",
      header: "Invoice #",
      thClassName: "w-[8%]",
      sortValue: (inv) => inv.invoiceNumber,
      exportValue: (inv) => inv.invoiceNumber,
      render: (inv) => (
        <span className="font-medium text-primary-600 whitespace-nowrap">
          #{inv.invoiceNumber}
        </span>
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
      thClassName: "w-[9%]",
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
      thClassName: "w-[9%]",
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
      key: "status",
      header: "Invoice Pay Status",
      thClassName: "w-[10%]",
      sortValue: (inv) =>
        statusOptions.find((o) => o.value === inv.status)?.label ?? inv.status,
      exportValue: (inv) => inv.status,
      render: (inv) => <StatusBadge status={inv.status} type="invoice" />,
    },
    {
      key: "woDescription",
      header: "WO Description",
      thClassName: "w-[18%]",
      exportValue: (inv) => inv.job?.description ?? inv.job?.summary ?? "",
      render: (inv) => {
        const text = inv.job?.description ?? inv.job?.summary;
        return text ? (
          <p className="text-sm text-gray-600 line-clamp-2" title={text}>
            {text}
          </p>
        ) : (
          <span className="text-gray-300">-</span>
        );
      },
    },
    {
      key: "summary",
      header: "Summary",
      thClassName: "w-[18%]",
      exportValue: (inv) => inv.job?.summary ?? "",
      render: (inv) =>
        inv.job?.summary ? (
          <p
            className="text-sm text-gray-600 line-clamp-2"
            title={inv.job.summary}
          >
            {inv.job.summary}
          </p>
        ) : (
          <span className="text-gray-300">-</span>
        ),
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
            currentState={{ search, status, sort, letter }}
            onApply={applyView}
          />
        </div>
      </div>

      {/* Category tabs */}
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
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex">
        {/* A-Z index: filters to invoices whose customer's displayed name
            (company name if on file, else first name) starts with the
            selected letter. Hidden on small screens where there isn't room. */}
        <div className="hidden sm:flex flex-col items-center gap-0.5 py-4 px-1.5 border-r border-gray-100 shrink-0">
          {ALPHABET.map((l) => (
            <button
              key={l}
              onClick={() => {
                selectLetter(l);
              }}
              title={`Show invoices for customers starting with "${l}"`}
              className={clsx(
                "w-6 h-6 rounded text-[11px] font-semibold leading-6 transition-colors",
                letter === l
                  ? "bg-primary-600 text-white"
                  : "text-gray-400 hover:bg-primary-50 hover:text-primary-600",
              )}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-0">
        {isLoading ? (
          <TableSkeleton rows={8} />
        ) : invoices.length === 0 ? (
          <EmptyState
            title="No invoices found"
            description={
              letter
                ? `No invoices for customers starting with "${letter}"`
                : undefined
            }
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
