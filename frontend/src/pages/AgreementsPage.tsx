import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PlusIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import api from "../lib/api";
import { ServiceAgreement, PaginatedResponse } from "../types";
import Button from "../components/ui/Button";
import Pagination from "../components/ui/Pagination";
import { StatusBadge } from "../components/ui/Badge";
import EmptyState from "../components/ui/EmptyState";
import { PageSpinner } from "../components/ui/Spinner";
import { formatCurrency, formatDate } from "../utils/formatters";
import { useLookup } from "../hooks/useMetadata";

function useAgreements(page: number, status: string) {
  return useQuery({
    queryKey: ["agreements", page, status],
    queryFn: () =>
      api.get<PaginatedResponse<ServiceAgreement>>("/agreements", {
        params: {
          page,
          limit: 20,
          status: status !== "all" ? status : undefined,
        },
      }),
  });
}

export default function AgreementsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const { data, isLoading } = useAgreements(page, status);
  const { options: statusOptions } = useLookup("agreementStatus");
  const statusFilters = [{ value: "all", label: "All" }, ...statusOptions];
  const { getLabel: getBillingLabel } = useLookup("billingFrequency");

  const agreements = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {pagination ? `${String(pagination.total)} agreements` : ""}
        </p>
        <Button icon={<PlusIcon className="h-4 w-4" />}>New Agreement</Button>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
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

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <PageSpinner />
        ) : agreements.length === 0 ? (
          <EmptyState
            title="No service agreements"
            description="Create recurring service agreements for your customers."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs uppercase">
                      Agreement
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Customer
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Name
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Term
                    </th>
                    <th className="text-right py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Amount
                    </th>
                    <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                      Status
                    </th>
                    <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs uppercase">
                      Next Billing
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {agreements.map((ag) => (
                    <tr
                      key={ag.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="py-3.5 px-5 font-medium text-primary-600">
                        #{ag.agreementNumber}
                      </td>
                      <td className="py-3.5 px-3 text-gray-900">
                        {ag.customer
                          ? `${ag.customer.firstName} ${ag.customer.lastName}`
                          : "-"}
                      </td>
                      <td className="py-3.5 px-3 text-gray-700">{ag.name}</td>
                      <td className="py-3.5 px-3 text-gray-500 text-xs">
                        {formatDate(ag.startDate)} – {formatDate(ag.endDate)}
                      </td>
                      <td className="py-3.5 px-3 text-right font-medium text-gray-900">
                        {formatCurrency(ag.amount)}
                        <span className="text-xs text-gray-400 block">
                          /{getBillingLabel(ag.billingFrequency)}
                        </span>
                      </td>
                      <td className="py-3.5 px-3">
                        <StatusBadge
                          status={ag.status}
                          category="agreementStatus"
                        />
                      </td>
                      <td className="py-3.5 px-5 text-gray-500 text-xs">
                        {formatDate(ag.nextBillingDate)}
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
