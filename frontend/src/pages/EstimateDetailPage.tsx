import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  ChevronRightIcon,
  PaperAirplaneIcon,
  CheckIcon,
  ArrowPathIcon,
  ArrowDownTrayIcon,
} from "@heroicons/react/24/outline";
import {
  useEstimate,
  useApproveEstimate,
  useConvertToInvoice,
} from "../hooks/useEstimates";
import Button from "../components/ui/Button";
import { StatusBadge } from "../components/ui/Badge";
import LineItemsTable from "../components/ui/LineItemsTable";
import AttachmentGallery from "../components/ui/AttachmentGallery";
import SignatureCard from "../components/ui/SignatureCard";
import SendEstimateModal from "../components/ui/SendEstimateModal";
import { PageSpinner } from "../components/ui/Spinner";
import { downloadPdf } from "../lib/pdf";
import { formatCurrency, formatDate } from "../utils/formatters";

export default function EstimateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [sendModal, setSendModal] = useState(false);
  const { data: estimate, isLoading } = useEstimate(id ?? "");
  const approveMutation = useApproveEstimate();
  const convertMutation = useConvertToInvoice();

  if (isLoading) return <PageSpinner />;
  if (!estimate)
    return (
      <div className="text-center py-12 text-gray-500">Quote not found</div>
    );

  const lineItems = (estimate.lineItems ?? []).map((li) => ({
    id: li.id,
    type: li.type,
    name: li.name,
    description: li.description,
    quantity: li.quantity,
    unitPrice: li.unitPrice,
    total: li.total,
  }));

  const discount = estimate.discountValue
    ? estimate.discountType === "percentage"
      ? estimate.subtotal * (estimate.discountValue / 100)
      : estimate.discountValue
    : 0;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-gray-500">
        <Link to="/estimates" className="hover:text-primary-600">
          Quotes
        </Link>
        <ChevronRightIcon className="h-3.5 w-3.5" />
        <span className="text-gray-900 font-medium">
          #{estimate.estimateNumber}
        </span>
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-gray-900">
                Quote #{estimate.estimateNumber}
              </h2>
              <StatusBadge status={estimate.status} type="estimate" />
            </div>
            <p className="text-gray-600 mt-1">{estimate.title}</p>
            {estimate.customer && (
              <p className="text-sm text-gray-500 mt-1">
                Customer:{" "}
                <Link
                  to={`/customers/${estimate.customerId}`}
                  className="text-primary-600 hover:text-primary-700 font-medium"
                >
                  {estimate.customer.firstName} {estimate.customer.lastName}
                </Link>
              </p>
            )}
          </div>
          <div className="flex gap-2 shrink-0 flex-wrap justify-end">
            <Button
              variant="outline"
              size="sm"
              icon={<ArrowDownTrayIcon className="h-4 w-4" />}
              onClick={() => {
                void downloadPdf(
                  `/estimates/${id ?? ""}/pdf`,
                  `Quote-${estimate.estimateNumber}.pdf`,
                );
              }}
            >
              PDF
            </Button>
            {estimate.status === "draft" && (
              <Button
                variant="outline"
                size="sm"
                icon={<PaperAirplaneIcon className="h-4 w-4" />}
                onClick={() => {
                  setSendModal(true);
                }}
              >
                Preview/Send
              </Button>
            )}
            {(estimate.status === "sent" || estimate.status === "viewed") && (
              <Button
                variant="primary"
                size="sm"
                icon={<CheckIcon className="h-4 w-4" />}
                onClick={() => {
                  approveMutation.mutate(id ?? "");
                }}
                loading={approveMutation.isPending}
              >
                Approve
              </Button>
            )}
            {estimate.status === "approved" && (
              <Button
                variant="primary"
                size="sm"
                icon={<ArrowPathIcon className="h-4 w-4" />}
                onClick={() => {
                  void convertMutation.mutateAsync(id ?? "").then(() => {
                    navigate("/invoices");
                  });
                }}
                loading={convertMutation.isPending}
              >
                Convert to Invoice
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                navigate(`/estimates/${id ?? ""}/edit`);
              }}
            >
              Edit
            </Button>
          </div>
        </div>

        <div className="mt-5 pt-5 border-t border-gray-100 grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-gray-500">Created</p>
            <p className="text-sm font-medium text-gray-900 mt-0.5">
              {formatDate(estimate.createdAt)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Valid Until</p>
            <p className="text-sm font-medium text-gray-900 mt-0.5">
              {formatDate(estimate.validUntil)}
            </p>
          </div>
          {estimate.approvedAt && (
            <div>
              <p className="text-xs text-gray-500">Approved</p>
              <p className="text-sm font-medium text-green-600 mt-0.5">
                {formatDate(estimate.approvedAt)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Line items */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Line Items</h3>
        <LineItemsTable
          items={lineItems}
          onChange={() => {
            /* read-only: no-op */
          }}
          readonly
        />
      </div>

      {/* Totals */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="ml-auto max-w-xs space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Subtotal</span>
            <span className="font-medium text-gray-900">
              {formatCurrency(estimate.subtotal)}
            </span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">
                Discount{" "}
                {estimate.discountType === "percentage"
                  ? `(${String(estimate.discountValue)}%)`
                  : ""}
              </span>
              <span className="font-medium text-red-600">
                -{formatCurrency(discount)}
              </span>
            </div>
          )}
          {estimate.taxAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Tax ({estimate.taxRate}%)</span>
              <span className="font-medium text-gray-900">
                {formatCurrency(estimate.taxAmount)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2 mt-2">
            <span className="text-gray-900">Total</span>
            <span className="text-primary-600">
              {formatCurrency(estimate.total)}
            </span>
          </div>
        </div>
      </div>

      {/* Notes & Terms */}
      {(Boolean(estimate.notes) || Boolean(estimate.terms)) && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          {estimate.notes && (
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-2">
                Notes
              </h4>
              <p className="text-sm text-gray-600 whitespace-pre-line">
                {estimate.notes}
              </p>
            </div>
          )}
          {estimate.terms && (
            <div>
              <h4 className="text-sm font-semibold text-gray-900 mb-2">
                Terms & Conditions
              </h4>
              <p className="text-sm text-gray-600 whitespace-pre-line">
                {estimate.terms}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Photos & Attachments */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <SignatureCard entityType="estimate" entityId={estimate.id} />
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <AttachmentGallery entityType="estimate" entityId={estimate.id} />
      </div>

      <SendEstimateModal
        isOpen={sendModal}
        estimate={estimate}
        onClose={() => {
          setSendModal(false);
        }}
      />
    </div>
  );
}
