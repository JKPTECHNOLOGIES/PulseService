import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PlusIcon,
  PencilIcon,
  ArrowDownTrayIcon,
} from "@heroicons/react/24/outline";
import { useCustomers } from "../hooks/useCustomers";
import { useLookup } from "../hooks/useMetadata";
import Button from "../components/ui/Button";
import SearchInput from "../components/ui/SearchInput";
import Pagination from "../components/ui/Pagination";
import Badge from "../components/ui/Badge";
import EmptyState from "../components/ui/EmptyState";
import DataTable, { Column, SortState } from "../components/ui/DataTable";
import SavedViewsMenu from "../components/ui/SavedViewsMenu";
import { PageSpinner } from "../components/ui/Spinner";
import { formatPhone, formatCurrency, formatDate } from "../utils/formatters";
import { downloadCsv } from "../utils/csv";
import type { Customer } from "../types";
import clsx from "clsx";

interface CustomersView {
  search: string;
  type: string;
  sort: SortState | null;
}

const csvColumns = [
  { header: "Number", value: (c: Customer) => c.customerNumber },
  { header: "First Name", value: (c: Customer) => c.firstName },
  { header: "Last Name", value: (c: Customer) => c.lastName },
  { header: "Company", value: (c: Customer) => c.companyName ?? "" },
  { header: "Type", value: (c: Customer) => c.type },
  { header: "Phone", value: (c: Customer) => c.phone ?? "" },
  { header: "Email", value: (c: Customer) => c.email ?? "" },
  { header: "Balance", value: (c: Customer) => c.balance },
  { header: "Created", value: (c: Customer) => formatDate(c.createdAt) },
];

export default function CustomersPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [sort, setSort] = useState<SortState | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const {
    options: customerTypeOptions,
    getLabel: getCustomerTypeLabel,
    getColor: getCustomerTypeColor,
  } = useLookup("customerType");
  const typeFilters = ["all", ...customerTypeOptions.map((o) => o.value)];

  const { data, isLoading } = useCustomers({
    page,
    limit: 20,
    search: search || undefined,
    type: type !== "all" ? type : undefined,
  });

  const customers = data?.data ?? [];
  const pagination = data?.pagination;

  const resetPage = () => {
    setPage(1);
    setSelectedIds([]);
  };

  const applyView = (view: CustomersView) => {
    setSearch(view.search);
    setType(view.type);
    setSort(view.sort);
    resetPage();
  };

  const columns: Column<Customer>[] = [
    {
      key: "name",
      header: "Customer",
      sortValue: (c) => `${c.lastName} ${c.firstName}`.toLowerCase(),
      exportValue: (c) => `${c.firstName} ${c.lastName}`,
      render: (c) => (
        <div>
          <p className="font-semibold text-gray-900">
            {c.firstName} {c.lastName}
          </p>
          {c.companyName && (
            <p className="text-xs text-gray-500 mt-0.5">{c.companyName}</p>
          )}
          <p className="text-xs text-gray-400">#{c.customerNumber}</p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      sortValue: (c) => c.type,
      exportValue: (c) => c.type,
      render: (c) => (
        <Badge className={getCustomerTypeColor(c.type)}>
          {getCustomerTypeLabel(c.type)}
        </Badge>
      ),
    },
    {
      key: "phone",
      header: "Phone",
      exportValue: (c) => c.phone ?? "",
      render: (c) => (
        <span className="text-gray-600">{formatPhone(c.phone)}</span>
      ),
    },
    {
      key: "email",
      header: "Email",
      sortValue: (c) => (c.email ?? "").toLowerCase(),
      exportValue: (c) => c.email ?? "",
      render: (c) => (
        <span className="text-gray-600 truncate max-w-[180px] inline-block align-middle">
          {c.email ?? "-"}
        </span>
      ),
    },
    {
      key: "created",
      header: "Created",
      sortValue: (c) => new Date(c.createdAt).getTime(),
      exportValue: (c) => formatDate(c.createdAt),
      render: (c) => (
        <span className="text-gray-500 text-xs">{formatDate(c.createdAt)}</span>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      sortValue: (c) => c.balance,
      exportValue: (c) => c.balance,
      render: (c) => (
        <span
          className={clsx(
            "font-medium",
            c.balance > 0 ? "text-red-600" : "text-gray-900",
          )}
        >
          {formatCurrency(c.balance)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500 mt-0.5">
            {pagination ? `${String(pagination.total)} total customers` : ""}
          </p>
        </div>
        <Button
          icon={<PlusIcon className="h-4 w-4" />}
          onClick={() => {
            navigate("/customers/new");
          }}
        >
          New Customer
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            resetPage();
          }}
          placeholder="Search customers..."
          className="sm:w-72"
        />
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {typeFilters.map((t) => (
            <button
              key={t}
              onClick={() => {
                setType(t);
                resetPage();
              }}
              className={clsx(
                "px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-colors",
                type === t
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700",
              )}
            >
              {t === "all" ? "All" : getCustomerTypeLabel(t)}
            </button>
          ))}
        </div>
        <div className="sm:ml-auto">
          <SavedViewsMenu<CustomersView>
            tableId="customers"
            currentState={{ search, type, sort }}
            onApply={applyView}
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <PageSpinner />
        ) : customers.length === 0 ? (
          <EmptyState
            title="No customers found"
            description="Get started by adding your first customer"
            action={{
              label: "New Customer",
              onClick: () => {
                navigate("/customers/new");
              },
            }}
          />
        ) : (
          <>
            <DataTable<Customer>
              columns={columns}
              rows={customers}
              getRowId={(c) => c.id}
              onRowClick={(c) => {
                navigate(`/customers/${c.id}`);
              }}
              sort={sort}
              onSortChange={setSort}
              selectable
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              csvFilename="customers"
              bulkActions={(rows) => (
                <button
                  onClick={() => {
                    downloadCsv("customers-selected", rows, csvColumns);
                  }}
                  className="flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-800"
                >
                  <ArrowDownTrayIcon className="h-4 w-4" />
                  Export selected
                </button>
              )}
              rowActions={(c) => (
                <button
                  onClick={() => {
                    navigate(`/customers/${c.id}/edit`);
                  }}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Edit"
                >
                  <PencilIcon className="h-4 w-4" />
                </button>
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
