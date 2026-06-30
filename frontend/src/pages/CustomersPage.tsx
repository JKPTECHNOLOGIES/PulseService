import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlusIcon, PencilIcon } from "@heroicons/react/24/outline";
import { useCustomers } from "../hooks/useCustomers";
import { useLookup } from "../hooks/useMetadata";
import Button from "../components/ui/Button";
import SearchInput from "../components/ui/SearchInput";
import Pagination from "../components/ui/Pagination";
import Badge from "../components/ui/Badge";
import EmptyState from "../components/ui/EmptyState";
import { PageSpinner } from "../components/ui/Spinner";
import { formatPhone, formatCurrency, formatDate } from "../utils/formatters";
import clsx from "clsx";

export default function CustomersPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");

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
            setPage(1);
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
                setPage(1);
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
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs uppercase tracking-wide">
                      Customer
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase tracking-wide">
                      Type
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase tracking-wide">
                      Phone
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase tracking-wide">
                      Email
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase tracking-wide">
                      Created
                    </th>
                    <th className="text-right py-3 px-3 font-medium text-gray-500 text-xs uppercase tracking-wide">
                      Balance
                    </th>
                    <th className="text-right py-3 px-5 font-medium text-gray-500 text-xs uppercase tracking-wide">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {customers.map((customer) => (
                    <tr
                      key={customer.id}
                      onClick={() => {
                        navigate(`/customers/${customer.id}`);
                      }}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                    >
                      <td className="py-3.5 px-5">
                        <div>
                          <p className="font-semibold text-gray-900">
                            {customer.firstName} {customer.lastName}
                          </p>
                          {customer.companyName && (
                            <p className="text-xs text-gray-500 mt-0.5">
                              {customer.companyName}
                            </p>
                          )}
                          <p className="text-xs text-gray-400">
                            #{customer.customerNumber}
                          </p>
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <Badge className={getCustomerTypeColor(customer.type)}>
                          {getCustomerTypeLabel(customer.type)}
                        </Badge>
                      </td>
                      <td className="py-3.5 px-3 text-gray-600">
                        {formatPhone(customer.phone)}
                      </td>
                      <td className="py-3.5 px-3 text-gray-600 truncate max-w-[180px]">
                        {customer.email ?? "-"}
                      </td>
                      <td className="py-3.5 px-3 text-gray-500 text-xs">
                        {formatDate(customer.createdAt)}
                      </td>
                      <td className="py-3.5 px-3 text-right font-medium">
                        <span
                          className={
                            customer.balance > 0
                              ? "text-red-600"
                              : "text-gray-900"
                          }
                        >
                          {formatCurrency(customer.balance)}
                        </span>
                      </td>
                      <td className="py-3.5 px-5">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/customers/${customer.id}/edit`);
                            }}
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            title="Edit"
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
