import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlusIcon, PaperAirplaneIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useInvoices, useSendInvoice } from "../hooks/useInvoices";
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
import { useLookup } from "../hooks/useMetadata";
import type { Invoice } from "../types";

interface InvoicesView {
  search: string;
  status: string;
  sort: SortState | null;
}

function customerName(inv: Invoice): string {
  return inv.customer
    ? `${inv.customer.firstName} ${inv.customer.lastName}`
    : "";
}

export default function InvoicesPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortState | null>(null);
  const { options: statusOptions } = useLookup("invoiceStatus");
  const statusFilters = [{ value: "all", label: "All" }, ...statusOptions];

  const { data, isLoading } = useInvoices({
    page,
    limit: 20,
    search: search || undefined,
    status: status !== "all" ? status : undefined,
  });
  const sendInvoice = useSendInvoice();

  const invoices = data?.data ?? [];
  const pagination = data?.pagination;

  const applyView = (view: InvoicesView) => {
    setSearch(view.search);
    setStatus(view.status);
    setSort(view.sort);
    setPage(1);
  };

  const columns: Column<Invoice>[] = [
    {
      key: "invoice",
      header: "Invoice",
      sortValue: (inv) => inv.invoiceNumber,
      exportValue: (inv) => inv.invoiceNumber,
      render: (inv) => (
        <span className="font-medium text-primary-600">
          #{inv.invoiceNumber}
        </span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      sortValue: (inv) => customerName(inv).toLowerCase(),
      exportValue: (inv) => customerName(inv),
      render: (inv) => (
        <span className="text-gray-900">{customerName(inv) || "-"}</span>
      ),
    },
    {
      key: "dueDate",
      header: "Due Date",
      sortValue: (inv) => (inv.dueDate ? new Date(inv.dueDate).getTime() : 0),
      exportValue: (inv) => (inv.dueDate ? formatDate(inv.dueDate) : ""),
      render: (inv) => (
        <span className="text-gray-500 text-xs">{formatDate(inv.dueDate)}</span>
      ),
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      sortValue: (inv) => inv.total,
      exportValue: (inv) => inv.total,
      render: (inv) => (
        <span className="font-medium text-gray-900">
          {formatCurrency(inv.total)}
        </span>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      sortValue: (inv) => inv.balance,
      exportValue: (inv) => inv.balance,
      render: (inv) => (
        <span
          className={clsx(
            "font-medium",
            inv.balance > 0 ? "text-red-600" : "text-green-600",
          )}
        >
          {formatCurrency(inv.balance)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (inv) => inv.status,
      exportValue: (inv) => inv.status,
      render: (inv) => <StatusBadge status={inv.status} type="invoice" />,
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {pagination ? `${String(pagination.total)} invoices` : ""}
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

      <div className="flex flex-col sm:flex-row gap-3">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search invoices..."
          className="sm:w-72"
        />
        <div className="flex flex-wrap gap-1 bg-gray-100 rounded-xl p-1">
          {statusFilters.map((s) => (
            <button
              key={s.value}
              onClick={() => {
                setStatus(s.value);
                setPage(1);
              }}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                status === s.value
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="sm:ml-auto">
          <SavedViewsMenu<InvoicesView>
            tableId="invoices"
            currentState={{ search, status, sort }}
            onApply={applyView}
          />
        </div>
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
                      sendInvoice.mutate(inv.id);
                    }}
                  >
                    <PaperAirplaneIcon className="h-4 w-4" />
                  </IconButton>
                ) : null
              }
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
