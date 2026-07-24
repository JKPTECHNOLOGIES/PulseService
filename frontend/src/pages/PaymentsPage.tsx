import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { CurrencyDollarIcon } from "@heroicons/react/24/outline";
import api from "../lib/api";
import { Payment, PaginatedResponse, Customer, Invoice } from "../types";
import StatCard from "../components/ui/StatCard";
import Pagination from "../components/ui/Pagination";
import Badge, { StatusBadge } from "../components/ui/Badge";
import EmptyState from "../components/ui/EmptyState";
import DataTable, { Column, SortState } from "../components/ui/DataTable";
import { TableSkeleton } from "../components/ui/Skeleton";
import { formatCurrency, formatDateTime } from "../utils/formatters";
import { useLookup } from "../hooks/useMetadata";

type PaymentWithRelations = Payment & {
  customer?: Customer;
  invoice?: Invoice;
};

function usePayments(page: number, sortKey?: string, sortDir?: string) {
  return useQuery({
    queryKey: ["payments", page, sortKey, sortDir],
    queryFn: () =>
      api.get<PaginatedResponse<PaymentWithRelations>>("/payments", {
        params: { page, limit: 20, sortKey, sortDir },
      }),
  });
}

function customerName(p: PaymentWithRelations): string {
  return p.customer ? `${p.customer.firstName} ${p.customer.lastName}` : "";
}

export default function PaymentsPage() {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortState | null>(null);
  const { data, isLoading } = usePayments(page, sort?.key, sort?.dir);
  const { getLabel: getMethodLabel, getColor: getMethodColor } =
    useLookup("paymentMethod");

  const payments = data?.data ?? [];
  const pagination = data?.pagination;
  const totalRevenue = payments.reduce((sum, p) => sum + p.amount, 0);

  const columns: Column<PaymentWithRelations>[] = [
    {
      key: "date",
      header: "Date",
      sortValue: (p) => (p.paidAt ? new Date(p.paidAt).getTime() : 0),
      exportValue: (p) => (p.paidAt ? formatDateTime(p.paidAt) : ""),
      render: (p) => (
        <span className="text-gray-700">{formatDateTime(p.paidAt)}</span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      sortValue: (p) => customerName(p).toLowerCase(),
      exportValue: (p) => customerName(p),
      render: (p) => (
        <span className="text-gray-900">{customerName(p) || "-"}</span>
      ),
    },
    {
      key: "invoice",
      header: "Invoice",
      exportValue: (p) => (p.invoice ? `#${p.invoice.invoiceNumber}` : ""),
      render: (p) =>
        p.invoice ? (
          <Link
            to={`/invoices/${p.invoice.id}`}
            onClick={(e) => {
              e.stopPropagation();
            }}
            className="text-primary-600 font-medium hover:underline"
          >
            #{p.invoice.invoiceNumber}
          </Link>
        ) : (
          <span className="text-gray-400">-</span>
        ),
    },
    {
      key: "method",
      header: "Method",
      sortValue: (p) => p.method,
      exportValue: (p) => getMethodLabel(p.method),
      render: (p) => (
        <Badge className={getMethodColor(p.method)}>
          {getMethodLabel(p.method)}
        </Badge>
      ),
    },
    {
      key: "reference",
      header: "Reference",
      exportValue: (p) => p.referenceNumber ?? "",
      render: (p) => (
        <span className="text-gray-500">{p.referenceNumber ?? "-"}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (p) => p.status,
      exportValue: (p) => p.status,
      render: (p) => <StatusBadge status={p.status} category="paymentStatus" />,
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      sortValue: (p) => p.amount,
      exportValue: (p) => p.amount,
      render: (p) => (
        <span className="font-semibold text-green-600">
          {formatCurrency(p.amount)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <StatCard
          title="Total Collected"
          value={formatCurrency(totalRevenue)}
          subtitle="This page"
          icon={<CurrencyDollarIcon />}
          color="green"
        />
        <StatCard
          title="Payments Recorded"
          value={pagination?.total ?? payments.length}
          subtitle="All time"
          icon={<CurrencyDollarIcon />}
          color="blue"
        />
        <StatCard
          title="Average Payment"
          value={formatCurrency(
            payments.length > 0 ? totalRevenue / payments.length : 0,
          )}
          icon={<CurrencyDollarIcon />}
          color="purple"
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <TableSkeleton rows={8} />
        ) : payments.length === 0 ? (
          <EmptyState
            title="No payments recorded"
            description="Payments will appear here once recorded against invoices."
          />
        ) : (
          <>
            <DataTable<PaymentWithRelations>
              columns={columns}
              rows={payments}
              getRowId={(p) => p.id}
              sort={sort}
              onSortChange={setSort}
              csvFilename="payments"
              renderMobileCard={(p) => (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-700">
                      {formatDateTime(p.paidAt)}
                    </span>
                    <span className="font-semibold text-green-600">
                      {formatCurrency(p.amount)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-900 mt-0.5">
                    {customerName(p) || "-"}
                    {p.invoice && (
                      <>
                        {" "}
                        ·{" "}
                        <Link
                          to={`/invoices/${p.invoice.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                          className="text-primary-600 font-medium hover:underline"
                        >
                          #{p.invoice.invoiceNumber}
                        </Link>
                      </>
                    )}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <Badge className={getMethodColor(p.method)}>
                      {getMethodLabel(p.method)}
                    </Badge>
                    <StatusBadge status={p.status} category="paymentStatus" />
                  </div>
                </div>
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
