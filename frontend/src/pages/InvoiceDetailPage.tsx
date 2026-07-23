import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import clsx from "clsx";
import {
  ChevronRightIcon,
  PaperAirplaneIcon,
  BanknotesIcon,
  NoSymbolIcon,
  PencilIcon,
  ArrowDownTrayIcon,
  ArrowUturnLeftIcon,
} from "@heroicons/react/24/outline";
import {
  useInvoice,
  useRecordPayment,
  useVoidInvoice,
  useRevertInvoiceToDraft,
  useReversePayment,
  useUpdateInvoice,
} from "../hooks/useInvoices";
import Button from "../components/ui/Button";
import { StatusBadge } from "../components/ui/Badge";
import { LookupSelect } from "../components/ui/LookupSelect";
import Modal from "../components/ui/Modal";
import SendInvoiceModal from "../components/ui/SendInvoiceModal";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import LineItemsTable from "../components/ui/LineItemsTable";
import AttachmentGallery from "../components/ui/AttachmentGallery";
import Timeline from "../components/ui/Timeline";
import { PageSpinner } from "../components/ui/Spinner";
import { downloadPdf } from "../lib/pdf";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
} from "../utils/formatters";
import { useLookup } from "../hooks/useMetadata";
import { usePermissions } from "../hooks/usePermissions";

interface PaymentForm {
  amount: number;
  method: string;
  referenceNumber?: string;
  notes?: string;
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [paymentModal, setPaymentModal] = useState(false);
  const [sendModal, setSendModal] = useState(false);
  const [voidConfirm, setVoidConfirm] = useState(false);
  const [revertConfirm, setRevertConfirm] = useState(false);
  const [reverseConfirm, setReverseConfirm] = useState<string | null>(null);

  const { data: invoice, isLoading } = useInvoice(id ?? "");
  const paymentMutation = useRecordPayment();
  const voidMutation = useVoidInvoice();
  const revertMutation = useRevertInvoiceToDraft();
  const reverseMutation = useReversePayment();
  const updateMutation = useUpdateInvoice();
  const { getLabel: getPaymentMethodLabel } = useLookup("paymentMethod");
  const { can } = usePermissions();

  const { register, handleSubmit, reset } = useForm<PaymentForm>({
    defaultValues: { method: "cash" },
  });

  if (isLoading) return <PageSpinner />;
  if (!invoice)
    return (
      <div className="text-center py-12 text-gray-500">Invoice not found</div>
    );

  const lineItems = (invoice.lineItems ?? []).map((li) => ({
    id: li.id,
    type: li.type,
    name: li.name,
    description: li.description,
    quantity: li.quantity,
    unitPrice: li.unitPrice,
    total: li.total,
    includeOnDocument: li.includeOnDocument,
  }));

  // Unlike the full Edit/Void buttons, toggling which lines are included is
  // still allowed after a payment lands -- it's a safe, reversible flag (not
  // a change to what was actually charged) and the backend recalculates the
  // total/balance accordingly. Only a void invoice blocks it entirely.
  const canEditLineItems = can("invoices.manage") && invoice.status !== "void";

  // Toggling a single line's inclusion re-sends the whole line-item set (the
  // backend replaces it wholesale) along with the invoice's current
  // discount, which the API otherwise defaults to 0 if omitted.
  const toggleLineItemInclude = (index: number) => {
    const updated = lineItems.map((li, i) =>
      i === index
        ? { ...li, includeOnDocument: li.includeOnDocument === false }
        : li,
    );
    updateMutation.mutate({
      id: invoice.id,
      lineItems: updated.map((li, idx) => ({ ...li, sortOrder: idx })),
      discountType: invoice.discountType,
      discountValue: invoice.discountValue,
    });
  };

  const discount = invoice.discountValue
    ? invoice.discountType === "percentage"
      ? invoice.subtotal * (invoice.discountValue / 100)
      : invoice.discountValue
    : 0;

  const onRecordPayment = async (data: PaymentForm) => {
    await paymentMutation.mutateAsync({
      invoiceId: id ?? "",
      amount: data.amount,
      method: data.method,
      referenceNumber: data.referenceNumber,
      notes: data.notes,
    });
    setPaymentModal(false);
    reset({ method: "cash" });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm text-gray-500">
        <Link to="/invoices" className="hover:text-primary-600">
          Invoices
        </Link>
        <ChevronRightIcon className="h-3.5 w-3.5" />
        <span className="text-gray-900 font-medium">
          #{invoice.invoiceNumber}
        </span>
      </div>

      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-gray-900">
                Invoice #{invoice.invoiceNumber}
              </h2>
              <StatusBadge status={invoice.status} type="invoice" />
            </div>
            {invoice.customer && (
              <p className="text-sm text-gray-500 mt-1">
                Customer:{" "}
                <Link
                  to={`/customers/${invoice.customerId}`}
                  className="text-primary-600 hover:text-primary-700 font-medium"
                >
                  {invoice.customer.firstName} {invoice.customer.lastName}
                </Link>
              </p>
            )}
            {invoice.serviceAgreement && (
              <p className="text-sm text-gray-500 mt-1">
                Service Agreement:{" "}
                <Link
                  to={`/agreements/${invoice.serviceAgreement.id}`}
                  className="text-primary-600 hover:text-primary-700 font-medium"
                >
                  #{invoice.serviceAgreement.agreementNumber}
                </Link>
                <span className="text-gray-400">
                  {" "}
                  — {invoice.serviceAgreement.name}
                </span>
              </p>
            )}
            {invoice.job && (
              <p className="text-sm text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                <span>
                  Work Order:{" "}
                  <Link
                    to={`/jobs/${invoice.job.id}`}
                    className="text-primary-600 hover:text-primary-700 font-medium"
                  >
                    #{invoice.job.jobNumber}
                  </Link>
                  {invoice.job.summary && (
                    <span className="text-gray-400">
                      {" "}
                      — {invoice.job.summary}
                    </span>
                  )}
                </span>
                {invoice.job.status && (
                  <StatusBadge status={invoice.job.status} type="job" />
                )}
              </p>
            )}
            {invoice.job?.purchaseOrders &&
              invoice.job.purchaseOrders.length > 0 && (
                <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5 flex-wrap">
                  <span className="text-gray-400">Purchase orders:</span>
                  {invoice.job.purchaseOrders.map((po, i, arr) => (
                    <span key={po.id} className="inline-flex items-center gap-1">
                      <Link
                        to={`/purchasing/${po.id}`}
                        className="font-mono text-primary-600 hover:text-primary-700"
                      >
                        {po.poNumber}
                      </Link>
                      <span className="text-gray-400">
                        ({formatCurrency(po.totalAmount)})
                      </span>
                      {i < arr.length - 1 && (
                        <span className="text-gray-300">·</span>
                      )}
                    </span>
                  ))}
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
                  `/invoices/${id ?? ""}/pdf`,
                  `Invoice-${invoice.invoiceNumber}.pdf`,
                );
              }}
            >
              PDF
            </Button>
            {can("invoices.manage") &&
              invoice.amountPaid === 0 &&
              invoice.status !== "void" && (
                <Button
                  variant="outline"
                  size="sm"
                  icon={<PencilIcon className="h-4 w-4" />}
                  onClick={() => {
                    navigate(`/invoices/${id ?? ""}/edit`);
                  }}
                >
                  Edit
                </Button>
              )}
            {can("invoices.manage") && invoice.status === "draft" && (
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
            {can("invoices.manage") &&
              invoice.status !== "draft" &&
              invoice.status !== "void" &&
              invoice.amountPaid === 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  icon={<ArrowUturnLeftIcon className="h-4 w-4" />}
                  onClick={() => {
                    setRevertConfirm(true);
                  }}
                >
                  Revert to Draft
                </Button>
              )}
            {can("invoices.manage") &&
              invoice.balance > 0 &&
              invoice.status !== "void" && (
                <Button
                  variant="primary"
                  size="sm"
                  icon={<BanknotesIcon className="h-4 w-4" />}
                  onClick={() => {
                    reset({ method: "cash", amount: invoice.balance });
                    setPaymentModal(true);
                  }}
                >
                  Record Payment
                </Button>
              )}
            {can("invoices.void") &&
              invoice.status !== "void" &&
              invoice.amountPaid === 0 && (
                <Button
                  variant="danger"
                  size="sm"
                  icon={<NoSymbolIcon className="h-4 w-4" />}
                  onClick={() => {
                    setVoidConfirm(true);
                  }}
                >
                  Void
                </Button>
              )}
          </div>
        </div>

        <div className="mt-5 pt-5 border-t border-gray-100 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-500">Issued</p>
            <p className="text-sm font-medium text-gray-900 mt-0.5">
              {formatDate(invoice.createdAt)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Due Date</p>
            <p className="text-sm font-medium text-gray-900 mt-0.5">
              {formatDate(invoice.dueDate)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Amount Paid</p>
            <p className="text-sm font-medium text-green-600 mt-0.5">
              {formatCurrency(invoice.amountPaid)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Balance Due</p>
            <p className="text-sm font-bold text-red-600 mt-0.5">
              {formatCurrency(invoice.balance)}
            </p>
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Line Items</h3>
        <LineItemsTable
          items={lineItems}
          onChange={() => {
            /* read-only */
          }}
          readonly
          showIncludeToggle
          onToggleInclude={
            canEditLineItems && !updateMutation.isPending
              ? toggleLineItemInclude
              : undefined
          }
        />
        {!canEditLineItems && (
          <p className="mt-3 text-xs text-gray-400">
            This invoice can't be changed because it is void.
          </p>
        )}
      </div>

      {/* Totals */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="ml-auto max-w-xs space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Subtotal</span>
            <span className="font-medium text-gray-900">
              {formatCurrency(invoice.subtotal)}
            </span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Discount</span>
              <span className="font-medium text-red-600">
                -{formatCurrency(discount)}
              </span>
            </div>
          )}
          {invoice.taxAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Tax ({invoice.taxRate}%)</span>
              <span className="font-medium text-gray-900">
                {formatCurrency(invoice.taxAmount)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-sm border-t border-gray-200 pt-2">
            <span className="text-gray-900 font-semibold">Total</span>
            <span className="font-semibold text-gray-900">
              {formatCurrency(invoice.total)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Amount Paid</span>
            <span className="font-medium text-green-600">
              -{formatCurrency(invoice.amountPaid)}
            </span>
          </div>
          <div className="flex justify-between text-base font-bold border-t border-gray-200 pt-2">
            <span className="text-gray-900">Balance Due</span>
            <span className="text-red-600">
              {formatCurrency(invoice.balance)}
            </span>
          </div>
        </div>
      </div>

      {/* Notes & Terms */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Notes & Terms</h3>
        {invoice.notes || invoice.terms ? (
          <div className="space-y-4">
            {invoice.notes && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Notes
                </p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {invoice.notes}
                </p>
              </div>
            )}
            {invoice.terms && (
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Terms
                </p>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {invoice.terms}
                </p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-400">No notes or terms added</p>
        )}
      </div>

      {/* Payment history */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Payment History</h3>
        {invoice.payments && invoice.payments.length > 0 ? (
          <>
            {/* Cards on narrow screens -- a 6-column table doesn't fit a phone. */}
            <div className="sm:hidden space-y-3">
              {invoice.payments.map((p) => (
                <div
                  key={p.id}
                  className="border border-gray-100 rounded-lg p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-gray-700">
                      {formatDateTime(p.paidAt)}
                    </span>
                    <StatusBadge status={p.status} category="paymentStatus" />
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-500">
                      {getPaymentMethodLabel(p.method)}
                      {p.referenceNumber ? ` · ${p.referenceNumber}` : ""}
                    </span>
                    <span
                      className={clsx(
                        "text-sm font-medium",
                        p.status === "refunded" || p.status === "reversed"
                          ? "text-gray-400 line-through"
                          : "text-green-600",
                      )}
                    >
                      {formatCurrency(p.amount)}
                    </span>
                  </div>
                  {can("invoices.void") &&
                    p.status === "completed" &&
                    invoice.status !== "void" && (
                      <button
                        type="button"
                        onClick={() => {
                          setReverseConfirm(p.id);
                        }}
                        className="mt-2 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-600"
                      >
                        <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
                        Reverse payment
                      </button>
                    )}
                </div>
              ))}
            </div>

            <table className="hidden sm:table w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 font-medium text-gray-500 text-xs">
                    DATE
                  </th>
                  <th className="text-left py-2 font-medium text-gray-500 text-xs">
                    METHOD
                  </th>
                  <th className="text-left py-2 font-medium text-gray-500 text-xs">
                    REFERENCE
                  </th>
                  <th className="text-left py-2 font-medium text-gray-500 text-xs">
                    STATUS
                  </th>
                  <th className="text-right py-2 font-medium text-gray-500 text-xs">
                    AMOUNT
                  </th>
                  {can("invoices.void") && <th className="py-2" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {invoice.payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2.5 text-gray-700">
                      {formatDateTime(p.paidAt)}
                    </td>
                    <td className="py-2.5 text-gray-700">
                      {getPaymentMethodLabel(p.method)}
                    </td>
                    <td className="py-2.5 text-gray-500">
                      {p.referenceNumber ?? "-"}
                    </td>
                    <td className="py-2.5">
                      <StatusBadge status={p.status} category="paymentStatus" />
                    </td>
                    <td
                      className={clsx(
                        "py-2.5 text-right font-medium",
                        p.status === "refunded" || p.status === "reversed"
                          ? "text-gray-400 line-through"
                          : "text-green-600",
                      )}
                    >
                      {formatCurrency(p.amount)}
                    </td>
                    {can("invoices.void") && (
                      <td className="py-2.5 text-right">
                        {p.status === "completed" &&
                          invoice.status !== "void" && (
                            <button
                              type="button"
                              onClick={() => {
                                setReverseConfirm(p.id);
                              }}
                              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-600"
                              title="Reverse this payment"
                            >
                              <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
                              Reverse
                            </button>
                          )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="text-sm text-gray-400">No payments recorded</p>
        )}
      </div>

      {/* Timeline: merged, narrated activity feed spanning this customer's
          work orders, invoices, and quotes, plus notes. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          <Timeline customerId={invoice.customerId} />
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <AttachmentGallery entityType="invoice" entityId={invoice.id} />
        </div>
      </div>

      {/* Record Payment Modal */}
      <Modal
        isOpen={paymentModal}
        onClose={() => {
          setPaymentModal(false);
        }}
        title="Record Payment"
      >
        <form
          onSubmit={(e) => void handleSubmit(onRecordPayment)(e)}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Amount
            </label>
            <input
              {...register("amount", { valueAsNumber: true })}
              type="number"
              step="0.01"
              min="0"
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Payment Method
            </label>
            <LookupSelect category="paymentMethod" {...register("method")} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Reference Number
            </label>
            <input
              {...register("referenceNumber")}
              type="text"
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Check #, transaction ID..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Notes
            </label>
            <textarea
              {...register("notes")}
              rows={2}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setPaymentModal(false);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={paymentMutation.isPending}>
              Record Payment
            </Button>
          </div>
        </form>
      </Modal>

      <SendInvoiceModal
        isOpen={sendModal}
        invoice={invoice}
        onClose={() => {
          setSendModal(false);
        }}
      />

      <ConfirmDialog
        isOpen={voidConfirm}
        onClose={() => {
          setVoidConfirm(false);
        }}
        onConfirm={() => {
          void voidMutation.mutateAsync(id ?? "").then(() => {
            setVoidConfirm(false);
          });
        }}
        title="Void Invoice"
        message="This invoice will be marked void and can no longer be edited, sent, or paid. This cannot be undone."
        confirmLabel="Void Invoice"
        loading={voidMutation.isPending}
      />

      <ConfirmDialog
        isOpen={revertConfirm}
        onClose={() => {
          setRevertConfirm(false);
        }}
        onConfirm={() => {
          void revertMutation.mutateAsync(id ?? "").then(() => {
            setRevertConfirm(false);
          });
        }}
        title="Revert to Draft"
        message="This puts the invoice back to Draft so it can be edited and sent again. It doesn't undo anything that's already been emailed to the customer."
        confirmLabel="Revert to Draft"
        loading={revertMutation.isPending}
      />

      <ConfirmDialog
        isOpen={!!reverseConfirm}
        onClose={() => {
          setReverseConfirm(null);
        }}
        onConfirm={() => {
          if (!reverseConfirm) return;
          void reverseMutation
            .mutateAsync({ paymentId: reverseConfirm, invoiceId: id ?? "" })
            .then(() => {
              setReverseConfirm(null);
            });
        }}
        title="Reverse Payment"
        message="Are you sure you want to reverse this payment? The invoice's balance will be restored, and this cannot be undone. Use this if the invoice needs to be voided or the payment was recorded in error."
        confirmLabel="Reverse Payment"
        loading={reverseMutation.isPending}
      />
    </div>
  );
}
