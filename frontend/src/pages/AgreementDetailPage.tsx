import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ChevronRightIcon,
  PencilIcon,
  PlusIcon,
  ArrowDownTrayIcon,
  PaperAirplaneIcon,
  BoltIcon,
} from "@heroicons/react/24/outline";
import {
  useAgreement,
  useUpdateAgreement,
  useSendAgreement,
  useGenerateAgreementInvoice,
} from "../hooks/useAgreements";
import {
  useGenerateRecurringJob,
  recurringFreqLabel,
} from "../hooks/useRecurring";
import { useLookup } from "../hooks/useMetadata";
import { usePermissions } from "../hooks/usePermissions";
import Button from "../components/ui/Button";
import { Can } from "../components/ui/Can";
import Badge, { StatusBadge } from "../components/ui/Badge";
import Modal from "../components/ui/Modal";
import { PageSpinner } from "../components/ui/Spinner";
import { NumberInput } from "../components/ui/NumberInput";
import { downloadPdf } from "../lib/pdf";
import { formatCurrency, formatDate, formatDateTime } from "../utils/formatters";

interface EditForm {
  name: string;
  status: string;
  billingFrequency: string;
  amount: number;
  startDate: string;
  endDate: string;
  autoRenew: boolean;
  terms: string;
  notes: string;
}

const inputClass =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white";

export default function AgreementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: agreement, isLoading } = useAgreement(id ?? "");
  const updateAgreement = useUpdateAgreement();
  const sendMutation = useSendAgreement();
  const generateInvoice = useGenerateAgreementInvoice();
  const generateRecurring = useGenerateRecurringJob();
  const { can } = usePermissions();

  const { options: statusOptions, getLabel: getStatusLabel } =
    useLookup("agreementStatus");
  const { options: billingOptions, getLabel: getBillingLabel } =
    useLookup("billingFrequency");

  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<EditForm>({
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

  useEffect(() => {
    if (agreement) {
      setForm({
        name: agreement.name,
        status: agreement.status,
        billingFrequency: agreement.billingFrequency,
        amount: agreement.amount,
        startDate: agreement.startDate ? agreement.startDate.slice(0, 10) : "",
        endDate: agreement.endDate ? agreement.endDate.slice(0, 10) : "",
        autoRenew: agreement.autoRenew,
        terms: agreement.terms ?? "",
        notes: agreement.notes ?? "",
      });
    }
  }, [agreement]);

  if (isLoading) return <PageSpinner />;
  if (!agreement) {
    return (
      <div className="text-center py-16 text-gray-400">
        Agreement not found.
      </div>
    );
  }

  const saveEdit = () => {
    updateAgreement.mutate(
      {
        id: agreement.id,
        name: form.name,
        status: form.status,
        billingFrequency: form.billingFrequency,
        amount: form.amount,
        startDate: form.startDate
          ? new Date(form.startDate).toISOString()
          : undefined,
        endDate: form.endDate
          ? new Date(form.endDate).toISOString()
          : undefined,
        autoRenew: form.autoRenew,
        terms: form.terms,
        notes: form.notes,
      },
      {
        onSuccess: () => {
          setEditOpen(false);
        },
      },
    );
  };

  const recurringJobs = agreement.recurringJobs ?? [];
  const invoices = agreement.invoices ?? [];
  const customerName = agreement.customer
    ? (agreement.customer.companyName ??
      `${agreement.customer.firstName} ${agreement.customer.lastName}`)
    : "-";

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 text-sm text-gray-500">
        <Link to="/agreements" className="hover:text-gray-700">
          Agreements
        </Link>
        <ChevronRightIcon className="h-4 w-4" />
        <span className="text-gray-900 font-medium">
          #{agreement.agreementNumber}
        </span>
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-gray-900">
              {agreement.name}
            </h1>
            <StatusBadge status={agreement.status} category="agreementStatus" />
          </div>
          <p className="text-sm text-gray-500 mt-1">
            #{agreement.agreementNumber} ·{" "}
            {agreement.customer ? (
              <Link
                to={`/customers/${agreement.customerId}`}
                className="text-primary-600 hover:text-primary-700"
              >
                {customerName}
              </Link>
            ) : (
              customerName
            )}
          </p>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap justify-end">
          <Button
            variant="outline"
            size="sm"
            icon={<ArrowDownTrayIcon className="h-4 w-4" />}
            onClick={() => {
              void downloadPdf(
                `/agreements/${id ?? ""}/pdf`,
                `Agreement-${agreement.agreementNumber}.pdf`,
              );
            }}
          >
            PDF
          </Button>
          {can("agreements.manage") && (
            <Button
              variant="outline"
              size="sm"
              icon={<PaperAirplaneIcon className="h-4 w-4" />}
              onClick={() => {
                sendMutation.mutate(id ?? "");
              }}
              loading={sendMutation.isPending}
            >
              Send
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            icon={<PencilIcon className="h-4 w-4" />}
            onClick={() => {
              setEditOpen(true);
            }}
          >
            Edit
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Details */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <h3 className="font-semibold text-gray-900 mb-4">Details</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
              <div>
                <dt className="text-xs text-gray-500">Amount</dt>
                <dd className="text-sm font-semibold text-gray-900 mt-0.5">
                  {formatCurrency(agreement.amount)}
                  <span className="text-xs font-normal text-gray-400">
                    {" "}
                    / {getBillingLabel(agreement.billingFrequency)}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Status</dt>
                <dd className="text-sm text-gray-900 mt-0.5">
                  {getStatusLabel(agreement.status)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Start Date</dt>
                <dd className="text-sm text-gray-900 mt-0.5">
                  {formatDate(agreement.startDate)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">End Date</dt>
                <dd className="text-sm text-gray-900 mt-0.5">
                  {formatDate(agreement.endDate)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Next Billing</dt>
                <dd className="text-sm text-gray-900 mt-0.5">
                  {formatDate(agreement.nextBillingDate)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Auto-Renew</dt>
                <dd className="text-sm text-gray-900 mt-0.5">
                  {agreement.autoRenew ? "Yes" : "No"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Last Sent</dt>
                <dd className="text-sm text-gray-900 mt-0.5">
                  {agreement.lastSentAt
                    ? formatDateTime(agreement.lastSentAt)
                    : "Never"}
                </dd>
              </div>
            </dl>

            {(Boolean(agreement.terms) || Boolean(agreement.notes)) && (
              <div className="mt-5 pt-5 border-t border-gray-100 space-y-4">
                {agreement.terms && (
                  <div>
                    <dt className="text-xs text-gray-500 mb-1">Terms</dt>
                    <dd className="text-sm text-gray-700 whitespace-pre-wrap">
                      {agreement.terms}
                    </dd>
                  </div>
                )}
                {agreement.notes && (
                  <div>
                    <dt className="text-xs text-gray-500 mb-1">Notes</dt>
                    <dd className="text-sm text-gray-700 whitespace-pre-wrap">
                      {agreement.notes}
                    </dd>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Billing: the monetary side of the agreement -- separate from
              Visits, which is the labor/scheduling side. */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">
                Billing ({invoices.length})
              </h3>
              <Can permission="agreements.manage">
                <Button
                  size="sm"
                  variant="outline"
                  icon={<BoltIcon className="h-3.5 w-3.5" />}
                  loading={generateInvoice.isPending}
                  onClick={() => {
                    generateInvoice.mutate(agreement.id);
                  }}
                >
                  Generate Invoice
                </Button>
              </Can>
            </div>
            {invoices.length === 0 ? (
              <p className="text-sm text-gray-400">
                No invoices generated yet.
              </p>
            ) : (
              <div className="space-y-2">
                {invoices.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between gap-2 text-sm border-b border-gray-50 pb-2 last:border-0 last:pb-0"
                  >
                    <Link
                      to={`/invoices/${inv.id}`}
                      className="font-medium text-primary-600 hover:text-primary-700"
                    >
                      #{inv.invoiceNumber}
                    </Link>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusBadge status={inv.status} type="invoice" />
                      <span className="font-medium text-gray-900">
                        {formatCurrency(inv.total)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recurring Visits: the labor/scheduling side, generated via the
            Recurring page's templates -- separate from Billing above, which
            is the monetary/invoicing side. */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-gray-900">
              Recurring Visits ({recurringJobs.length})
            </h3>
            <Can permission={["jobs.create", "agreements.manage"]}>
              <button
                onClick={() => {
                  navigate("/recurring", {
                    state: {
                      agreementId: agreement.id,
                      agreementNumber: agreement.agreementNumber,
                      customerId: agreement.customerId,
                    },
                  });
                }}
                className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                New
              </button>
            </Can>
          </div>
          {recurringJobs.length === 0 ? (
            <p className="text-sm text-gray-400">
              No recurring visits scheduled yet.
            </p>
          ) : (
            <div className="space-y-3">
              {recurringJobs.map((r) => (
                <div
                  key={r.id}
                  className="flex items-start justify-between gap-2 border-b border-gray-50 pb-3 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {r.summary}
                    </p>
                    <p className="text-xs text-gray-500">
                      {recurringFreqLabel(r.frequency)} · Next{" "}
                      {formatDate(r.nextRunDate)} · {r._count?.jobs ?? 0}{" "}
                      generated
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge
                      className={
                        r.isActive
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      }
                    >
                      {r.isActive ? "Active" : "Paused"}
                    </Badge>
                    <Can permission={["jobs.create", "agreements.manage"]}>
                      <button
                        title="Generate a work order now"
                        onClick={() => {
                          generateRecurring.mutate(r.id);
                        }}
                        disabled={generateRecurring.isPending}
                        className="text-gray-400 hover:text-primary-600 disabled:opacity-50"
                      >
                        <BoltIcon className="h-4 w-4" />
                      </button>
                    </Can>
                  </div>
                </div>
              ))}
              <Link
                to="/recurring"
                className="block text-xs text-primary-600 hover:text-primary-700 font-medium pt-1"
              >
                Manage on the Recurring page →
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Edit modal */}
      <Modal
        isOpen={editOpen}
        onClose={() => {
          setEditOpen(false);
        }}
        title="Edit Agreement"
        size="lg"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Name
            </label>
            <input
              className={inputClass}
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
              <NumberInput
                step="0.01"
                className={inputClass}
                value={form.amount}
                onChange={(n) => {
                  setForm({ ...form, amount: n ?? 0 });
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
                Start Date
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
                End Date
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
                setEditOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={saveEdit}
              loading={updateAgreement.isPending}
              disabled={!form.name.trim()}
            >
              Save Changes
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
