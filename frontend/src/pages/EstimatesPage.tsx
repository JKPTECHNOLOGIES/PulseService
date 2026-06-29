import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PlusIcon,
  EyeIcon,
  PaperAirplaneIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import {
  useEstimates,
  useSendEstimate,
  useConvertToInvoice,
} from "../hooks/useEstimates";
import { useLookup } from "../hooks/useMetadata";
import Button from "../components/ui/Button";
import SearchInput from "../components/ui/SearchInput";
import Pagination from "../components/ui/Pagination";
import { StatusBadge } from "../components/ui/Badge";
import EmptyState from "../components/ui/EmptyState";
import { PageSpinner } from "../components/ui/Spinner";
import { formatCurrency, formatDate } from "../utils/formatters";

export default function EstimatesPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

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

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {pagination ? `${String(pagination.total)} estimates` : ""}
        </p>
        <Button
          icon={<PlusIcon className="h-4 w-4" />}
          onClick={() => {
            navigate("/estimates/new");
          }}
        >
          New Estimate
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Search estimates..."
          className="sm:w-72"
        />
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
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
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <PageSpinner />
        ) : estimates.length === 0 ? (
          <EmptyState
            title="No estimates found"
            action={{
              label: "New Estimate",
              onClick: () => {
                navigate("/estimates/new");
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
                      Estimate
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Customer
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Title
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Date
                    </th>
                    <th className="text-right py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Total
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Status
                    </th>
                    <th className="text-right py-3 px-5 font-medium text-gray-500 text-xs uppercase">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {estimates.map((est) => (
                    <tr
                      key={est.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="py-3.5 px-5 font-medium text-primary-600">
                        #{est.estimateNumber}
                      </td>
                      <td className="py-3.5 px-3 text-gray-900">
                        {est.customer
                          ? `${est.customer.firstName} ${est.customer.lastName}`
                          : "-"}
                      </td>
                      <td className="py-3.5 px-3 text-gray-700 truncate max-w-[180px]">
                        {est.title}
                      </td>
                      <td className="py-3.5 px-3 text-gray-500 text-xs">
                        {formatDate(est.createdAt)}
                      </td>
                      <td className="py-3.5 px-3 text-right font-medium text-gray-900">
                        {formatCurrency(est.total)}
                      </td>
                      <td className="py-3.5 px-3">
                        <StatusBadge status={est.status} type="estimate" />
                      </td>
                      <td className="py-3.5 px-5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => {
                              navigate(`/estimates/${est.id}`);
                            }}
                            className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                            title="View"
                          >
                            <EyeIcon className="h-4 w-4" />
                          </button>
                          {est.status === "draft" && (
                            <button
                              onClick={() => {
                                sendEstimate.mutate(est.id);
                              }}
                              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                              title="Send"
                            >
                              <PaperAirplaneIcon className="h-4 w-4" />
                            </button>
                          )}
                          {est.status === "approved" && (
                            <button
                              onClick={() => {
                                convertToInvoice.mutate(est.id);
                              }}
                              className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg"
                              title="Convert to Invoice"
                            >
                              <ArrowPathIcon className="h-4 w-4" />
                            </button>
                          )}
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
