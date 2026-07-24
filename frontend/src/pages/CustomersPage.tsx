import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PlusIcon,
  PencilIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  LinkIcon,
} from "@heroicons/react/24/outline";
import { useCustomers } from "../hooks/useCustomers";
import { useLookup } from "../hooks/useMetadata";
import Button from "../components/ui/Button";
import IconButton from "../components/ui/IconButton";
import SearchInput from "../components/ui/SearchInput";
import Pagination from "../components/ui/Pagination";
import Badge from "../components/ui/Badge";
import EmptyState from "../components/ui/EmptyState";
import DataTable, { Column, SortState } from "../components/ui/DataTable";
import SavedViewsMenu from "../components/ui/SavedViewsMenu";
import ImportModal from "../components/ui/ImportModal";
import { TableSkeleton } from "../components/ui/Skeleton";
import { formatPhone, formatCurrency, formatDate } from "../utils/formatters";
import { downloadCsv } from "../utils/csv";
import type { Customer } from "../types";
import clsx from "clsx";

interface CustomersView {
  search: string;
  type: string;
  sort: SortState | null;
  letter: string | null;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

// FieldEdge-style "multiple customers under one primary": a secondary's sort
// position is derived from its primary's values (see customers.controller.js
// list()), so the whole cluster sorts and stays adjacent as a unit instead of
// scattering by each row's own value.
function sortBasis(c: Customer) {
  const basis = c.primaryCustomer ?? c;
  return {
    name: `${basis.firstName} ${basis.lastName}`.toLowerCase(),
    type: basis.type ?? c.type,
    email: (basis.email ?? "").toLowerCase(),
    created: new Date(basis.createdAt ?? c.createdAt).getTime(),
    balance: basis.balance ?? c.balance,
  };
}

function isClusterMember(c: Customer): boolean {
  return Boolean(c.primaryCustomer) || (c._count?.subCustomers ?? 0) > 0;
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
  const [letter, setLetter] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [importOpen, setImportOpen] = useState(false);

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
    letter: letter ?? undefined,
    // Sorting has to happen server-side across the whole filtered set, not
    // just the 20 rows on the current page -- DataTable's own sort only ever
    // reorders whatever `rows` it's given.
    sortKey: sort?.key,
    sortDir: sort?.dir,
  });

  const customers = useMemo(() => data?.data ?? [], [data]);
  const pagination = data?.pagination;

  // Tint per primary/secondary cluster (rows arrive from the API already
  // grouped -- see customers.controller.js list()) so a family of linked
  // customers is visually scannable without reading every row. EVERY cluster
  // member gets one of two bands -- alternating which band, never "no tint"
  // -- so consecutive clusters (e.g. Ashbritt Inc immediately followed by
  // Ballenisles) don't visually merge into one family. `gray` (not `primary`)
  // on purpose: it's the theme's dark-aware neutral ramp (see index.css), so
  // this stays visible in light mode and doesn't wash out dark mode the way
  // a fixed-color tint like primary-50 would.
  const rowTintById = useMemo(() => {
    const map = new Map<string, string>();
    let lastKey: string | null = null;
    let band = false;
    for (const c of customers) {
      if (!isClusterMember(c)) continue;
      const key = c.primaryCustomerId ?? c.id;
      if (key !== lastKey) {
        band = !band;
        lastKey = key;
      }
      map.set(c.id, band ? "bg-gray-200/70" : "bg-gray-100");
    }
    return map;
  }, [customers]);

  const resetPage = () => {
    setPage(1);
    setSelectedIds([]);
  };

  const applyView = (view: CustomersView) => {
    setSearch(view.search);
    setType(view.type);
    setSort(view.sort);
    setLetter(view.letter);
    resetPage();
  };

  const selectLetter = (l: string) => {
    setLetter((current) => (current === l ? null : l));
    setSearch("");
    resetPage();
  };

  const columns: Column<Customer>[] = [
    {
      key: "name",
      header: "Customer",
      sortValue: (c) => sortBasis(c).name,
      exportValue: (c) => `${c.firstName} ${c.lastName}`,
      render: (c) => (
        <div>
          <div className="flex items-center gap-1.5">
            <p className="font-semibold text-gray-900">
              {c.firstName} {c.lastName}
            </p>
            {(c._count?.subCustomers ?? 0) > 0 && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary-500/10 text-primary-700 text-[11px] font-medium"
                title="Other customers linked to this one"
              >
                <LinkIcon className="h-3 w-3" />
                {c._count?.subCustomers} linked
              </span>
            )}
          </div>
          {c.companyName && (
            <p className="text-xs text-gray-500 mt-0.5">{c.companyName}</p>
          )}
          {c.primaryCustomer && (
            <p className="text-xs text-primary-600 mt-0.5 flex items-center gap-1">
              <LinkIcon className="h-3 w-3 shrink-0" />
              Part of{" "}
              {c.primaryCustomer.companyName ??
                `${c.primaryCustomer.firstName} ${c.primaryCustomer.lastName}`}
            </p>
          )}
          <p className="text-xs text-gray-400">#{c.customerNumber}</p>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      sortValue: (c) => sortBasis(c).type,
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
      sortValue: (c) => sortBasis(c).email,
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
      sortValue: (c) => sortBasis(c).created,
      exportValue: (c) => formatDate(c.createdAt),
      render: (c) => (
        <span className="text-gray-500 text-xs">{formatDate(c.createdAt)}</span>
      ),
    },
    {
      key: "balance",
      header: "Balance",
      align: "right",
      sortValue: (c) => sortBasis(c).balance,
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
        <div className="flex gap-2">
          <Button
            variant="outline"
            icon={<ArrowUpTrayIcon className="h-4 w-4" />}
            onClick={() => {
              setImportOpen(true);
            }}
          >
            Import
          </Button>
          <Button
            icon={<PlusIcon className="h-4 w-4" />}
            onClick={() => {
              navigate("/customers/new");
            }}
          >
            New Customer
          </Button>
        </div>
      </div>

      <ImportModal
        isOpen={importOpen}
        onClose={() => {
          setImportOpen(false);
        }}
        title="Import Customers"
        endpoint="/customers/import"
        invalidateKey={["customers"]}
        templateColumns={[
          "firstName",
          "lastName",
          "phone",
          "email",
          "type",
          "companyName",
          "source",
        ]}
      />

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setLetter(null);
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
            currentState={{ search, type, sort, letter }}
            onApply={applyView}
          />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex">
        {/* A-Z index: filters to customers whose first name starts with the
            selected letter (matches the list's default alphabetical sort).
            Hidden on small screens where there isn't room for it. */}
        <div className="hidden sm:flex flex-col items-center gap-0.5 py-4 px-1.5 border-r border-gray-100 shrink-0">
          {ALPHABET.map((l) => (
            <button
              key={l}
              onClick={() => {
                selectLetter(l);
              }}
              title={`Show customers starting with "${l}"`}
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
        ) : customers.length === 0 ? (
          <EmptyState
            title="No customers found"
            description={
              letter
                ? `No customers with a first name starting with "${letter}"`
                : "Get started by adding your first customer"
            }
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
              rowClassName={(c) => rowTintById.get(c.id)}
              renderMobileCard={(c) => (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-gray-900 truncate">
                      {c.firstName} {c.lastName}
                    </p>
                    <span
                      className={clsx(
                        "font-medium text-sm shrink-0",
                        c.balance > 0 ? "text-red-600" : "text-gray-900",
                      )}
                    >
                      {formatCurrency(c.balance)}
                    </span>
                  </div>
                  {c.companyName && (
                    <p className="text-xs text-gray-500">{c.companyName}</p>
                  )}
                  {c.primaryCustomer && (
                    <p className="text-xs text-primary-600 flex items-center gap-1">
                      <LinkIcon className="h-3 w-3 shrink-0" />
                      Part of{" "}
                      {c.primaryCustomer.companyName ??
                        `${c.primaryCustomer.firstName} ${c.primaryCustomer.lastName}`}
                    </p>
                  )}
                  {(c._count?.subCustomers ?? 0) > 0 && (
                    <p className="text-xs text-primary-700 font-medium flex items-center gap-1">
                      <LinkIcon className="h-3 w-3 shrink-0" />
                      {c._count?.subCustomers} linked customers
                    </p>
                  )}
                  <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                    <Badge className={getCustomerTypeColor(c.type)}>
                      {getCustomerTypeLabel(c.type)}
                    </Badge>
                    <span className="text-xs text-gray-400">
                      #{c.customerNumber}
                    </span>
                  </div>
                  <div className="mt-1.5 text-sm text-gray-600 space-y-0.5">
                    {c.phone && <p>{formatPhone(c.phone)}</p>}
                    {c.email && <p className="truncate">{c.email}</p>}
                  </div>
                </div>
              )}
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
                <IconButton
                  label="Edit customer"
                  onClick={() => {
                    navigate(`/customers/${c.id}/edit`);
                  }}
                >
                  <PencilIcon className="h-4 w-4" />
                </IconButton>
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
    </div>
  );
}
