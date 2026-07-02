import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PlusIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import { useAgreements, useCreateAgreement } from "../hooks/useAgreements";
import { useCustomers } from "../hooks/useCustomers";
import Button from "../components/ui/Button";
import Modal from "../components/ui/Modal";
import Pagination from "../components/ui/Pagination";
import { StatusBadge } from "../components/ui/Badge";
import EmptyState from "../components/ui/EmptyState";
import DataTable, { Column, SortState } from "../components/ui/DataTable";
import { TableSkeleton } from "../components/ui/Skeleton";
import { formatCurrency, formatDate } from "../utils/formatters";
import { useLookup } from "../hooks/useMetadata";
import type { ServiceAgreement } from "../types";

function agCustomerName(ag: ServiceAgreement): string {
  return ag.customer ? `${ag.customer.firstName} ${ag.customer.lastName}` : "";
}

const inputClass =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white";

export default function AgreementsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState<SortState | null>(null);
  const { data, isLoading } = useAgreements({
    page,
    status: status !== "all" ? status : undefined,
  });
  const { options: statusOptions } = useLookup("agreementStatus");
  const statusFilters = [{ value: "all", label: "All" }, ...statusOptions];
  const { options: billingOptions, getLabel: getBillingLabel } =
    useLookup("billingFrequency");
  const { data: customersData } = useCustomers({ limit: 200 });
  const customers = customersData?.data ?? [];
  const createAgreement = useCreateAgreement();

  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({
    customerId: "",
    name: "",
    status: "active",
    billingFrequency: "monthly",
    amount: 0,
    startDate: "",
    endDate: "",
    autoRenew: false,
    terms: "",
    notes: "",
  });

  const submitNew = () => {
    if (
      !form.customerId ||
      !form.name.trim() ||
      !form.startDate ||
      !form.endDate
    )
      return;
    void createAgreement
      .mutateAsync({
        customerId: form.customerId,
        name: form.name.trim(),
        status: form.status,
        billingFrequency: form.billingFrequency,
        amount: form.amount,
        startDate: new Date(form.startDate).toISOString(),
        endDate: new Date(form.endDate).toISOString(),
        autoRenew: form.autoRenew,
        terms: form.terms,
        notes: form.notes,
      })
      .then((res) => {
        setNewOpen(false);
        navigate(`/agreements/${res.data.id}`);
      });
  };

  const agreements = data?.data ?? [];
  const pagination = data?.pagination;

  const columns: Column<ServiceAgreement>[] = [
    {
      key: "agreement",
      header: "Agreement",
      sortValue: (ag) => ag.agreementNumber,
      exportValue: (ag) => ag.agreementNumber,
      render: (ag) => (
        <span className="font-medium text-primary-600">
          #{ag.agreementNumber}
        </span>
      ),
    },
    {
      key: "customer",
      header: "Customer",
      sortValue: (ag) => agCustomerName(ag).toLowerCase(),
      exportValue: (ag) => agCustomerName(ag),
      render: (ag) => (
        <span className="text-gray-900">{agCustomerName(ag) || "-"}</span>
      ),
    },
    {
      key: "name",
      header: "Name",
      sortValue: (ag) => ag.name.toLowerCase(),
      exportValue: (ag) => ag.name,
      render: (ag) => <span className="text-gray-700">{ag.name}</span>,
    },
    {
      key: "term",
      header: "Term",
      sortValue: (ag) => new Date(ag.startDate).getTime(),
      exportValue: (ag) =>
        `${formatDate(ag.startDate)} - ${formatDate(ag.endDate)}`,
      render: (ag) => (
        <span className="text-gray-500 text-xs">
          {formatDate(ag.startDate)} – {formatDate(ag.endDate)}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      sortValue: (ag) => ag.amount,
      exportValue: (ag) => ag.amount,
      render: (ag) => (
        <span className="font-medium text-gray-900">
          {formatCurrency(ag.amount)}
          <span className="text-xs text-gray-400 block">
            /{getBillingLabel(ag.billingFrequency)}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (ag) => ag.status,
      exportValue: (ag) => ag.status,
      render: (ag) => (
        <StatusBadge status={ag.status} category="agreementStatus" />
      ),
    },
    {
      key: "nextBilling",
      header: "Next Billing",
      sortValue: (ag) =>
        ag.nextBillingDate ? new Date(ag.nextBillingDate).getTime() : 0,
      exportValue: (ag) =>
        ag.nextBillingDate ? formatDate(ag.nextBillingDate) : "",
      render: (ag) => (
        <span className="text-gray-500 text-xs">
          {formatDate(ag.nextBillingDate)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {pagination ? `${String(pagination.total)} agreements` : ""}
        </p>
        <Button
          icon={<PlusIcon className="h-4 w-4" />}
          onClick={() => {
            setNewOpen(true);
          }}
        >
          New Agreement
        </Button>
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
          <TableSkeleton rows={8} />
        ) : agreements.length === 0 ? (
          <EmptyState
            title="No service agreements"
            description="Create recurring service agreements for your customers."
          />
        ) : (
          <>
            <DataTable<ServiceAgreement>
              columns={columns}
              rows={agreements}
              getRowId={(ag) => ag.id}
              onRowClick={(ag) => {
                navigate(`/agreements/${ag.id}`);
              }}
              sort={sort}
              onSortChange={setSort}
              csvFilename="agreements"
              renderMobileCard={(ag) => (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-primary-600">
                      #{ag.agreementNumber}
                    </span>
                    <StatusBadge
                      status={ag.status}
                      category="agreementStatus"
                    />
                  </div>
                  <p className="text-sm text-gray-700 mt-0.5">{ag.name}</p>
                  <p className="text-xs text-gray-500">
                    {agCustomerName(ag) || "-"}
                  </p>
                  <div className="mt-1.5 flex items-center justify-between text-sm">
                    <span className="text-gray-500 text-xs">
                      {formatDate(ag.startDate)} – {formatDate(ag.endDate)}
                    </span>
                    <span className="font-medium text-gray-900">
                      {formatCurrency(ag.amount)}/
                      {getBillingLabel(ag.billingFrequency)}
                    </span>
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

      <Modal
        isOpen={newOpen}
        onClose={() => {
          setNewOpen(false);
        }}
        title="New Agreement"
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Customer <span className="text-red-500">*</span>
            </label>
            <select
              className={inputClass}
              value={form.customerId}
              onChange={(e) => {
                setForm({ ...form, customerId: e.target.value });
              }}
            >
              <option value="">Select customer…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                  {c.companyName ? ` (${c.companyName})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              className={inputClass}
              placeholder="e.g. Residential Comfort Plan"
              value={form.name}
              onChange={(e) => {
                setForm({ ...form, name: e.target.value });
              }}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Status
              </label>
              <select
                className={inputClass}
                value={form.status}
                onChange={(e) => {
                  setForm({ ...form, status: e.target.value });
                }}
              >
                {statusOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Billing Frequency
              </label>
              <select
                className={inputClass}
                value={form.billingFrequency}
                onChange={(e) => {
                  setForm({ ...form, billingFrequency: e.target.value });
                }}
              >
                {billingOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Amount
              </label>
              <input
                type="number"
                step="0.01"
                className={inputClass}
                value={form.amount}
                onChange={(e) => {
                  setForm({ ...form, amount: Number(e.target.value) });
                }}
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-700 pb-2.5">
                <input
                  type="checkbox"
                  checked={form.autoRenew}
                  onChange={(e) => {
                    setForm({ ...form, autoRenew: e.target.checked });
                  }}
                  className="rounded text-primary-600 focus:ring-primary-500"
                />
                Auto-renew
              </label>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Start Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                className={inputClass}
                value={form.startDate}
                onChange={(e) => {
                  setForm({ ...form, startDate: e.target.value });
                }}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                End Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                className={inputClass}
                value={form.endDate}
                onChange={(e) => {
                  setForm({ ...form, endDate: e.target.value });
                }}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Terms
            </label>
            <textarea
              rows={2}
              className={inputClass}
              value={form.terms}
              onChange={(e) => {
                setForm({ ...form, terms: e.target.value });
              }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Notes
            </label>
            <textarea
              rows={2}
              className={inputClass}
              value={form.notes}
              onChange={(e) => {
                setForm({ ...form, notes: e.target.value });
              }}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setNewOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={submitNew}
              loading={createAgreement.isPending}
              disabled={
                !form.customerId ||
                !form.name.trim() ||
                !form.startDate ||
                !form.endDate
              }
            >
              Create Agreement
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
