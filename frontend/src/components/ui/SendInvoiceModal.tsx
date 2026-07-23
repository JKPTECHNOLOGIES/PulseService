import { useState } from "react";
import clsx from "clsx";
import SendDocumentModal from "./SendDocumentModal";
import { useSendInvoice, useUpdateInvoice } from "../../hooks/useInvoices";
import { useCompanySettings } from "../../hooks/useSettings";
import type { Invoice } from "../../types";

interface Props {
  isOpen: boolean;
  invoice: Invoice;
  onClose: () => void;
}

const DAY_MS = 86400000;

/** "Print / Email Invoice" dialog - see SendDocumentModal for the shared UI. */
export default function SendInvoiceModal({ isOpen, invoice, onClose }: Props) {
  const sendMutation = useSendInvoice();
  const updateMutation = useUpdateInvoice();
  const { data: companySettings } = useCompanySettings();
  const [savingTerms, setSavingTerms] = useState(false);

  const primaryName =
    invoice.customer?.companyName ??
    `${invoice.customer?.firstName ?? ""} ${invoice.customer?.lastName ?? ""}`.trim();

  // Net 30 vs. Due on Receipt, derived from the invoice's own due date so the
  // toggle always reflects what's actually saved (and thus what the PDF
  // preview shows) rather than tracking a separate, possibly-stale local copy.
  const createdAtMs = new Date(invoice.createdAt).getTime();
  const daysUntilDue = invoice.dueDate
    ? Math.round((new Date(invoice.dueDate).getTime() - createdAtMs) / DAY_MS)
    : 0;
  const isDueOnReceipt = daysUntilDue <= 0;

  const setTerms = (option: "net30" | "dueOnReceipt") => {
    const days = option === "net30" ? 30 : 0;
    const dueDate = new Date(createdAtMs + days * DAY_MS).toISOString();
    setSavingTerms(true);
    void updateMutation
      .mutateAsync({
        id: invoice.id,
        dueDate,
        // The update endpoint zeroes discount/tax on any field it isn't
        // explicitly given, so the invoice's current discount has to be
        // passed through untouched here (see InvoiceDetailPage's identical
        // pattern for the line-item include toggle).
        discountType: invoice.discountType,
        discountValue: invoice.discountValue,
      })
      .finally(() => {
        setSavingTerms(false);
      });
  };

  const termsToggle = (
    <div>
      <p className="text-sm font-medium text-gray-700 mb-1.5">Terms</p>
      <div className="inline-flex gap-1 bg-gray-100 rounded-lg p-1">
        <button
          type="button"
          disabled={savingTerms}
          onClick={() => {
            setTerms("dueOnReceipt");
          }}
          className={clsx(
            "px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-60",
            isDueOnReceipt
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700",
          )}
        >
          Due on Receipt
        </button>
        <button
          type="button"
          disabled={savingTerms}
          onClick={() => {
            setTerms("net30");
          }}
          className={clsx(
            "px-3 py-1.5 rounded-md text-sm font-medium transition-colors disabled:opacity-60",
            !isDueOnReceipt
              ? "bg-white text-gray-900 shadow-sm"
              : "text-gray-500 hover:text-gray-700",
          )}
        >
          Net 30 Days
        </button>
      </div>
    </div>
  );

  return (
    <SendDocumentModal
      isOpen={isOpen}
      onClose={onClose}
      title="Print / Email Invoice"
      pdfPath={`/invoices/${invoice.id}/pdf`}
      pdfPreviewLabel={`Invoice ${invoice.invoiceNumber} preview`}
      attachmentHint={`Invoice-${invoice.invoiceNumber}.pdf will be attached`}
      customerId={invoice.customerId}
      defaultSubject="Your Invoice is Ready"
      defaultMessage={`Hello ${primaryName || "there"}, your invoice ${invoice.invoiceNumber} is attached to this message and is ready for review. Please contact the office${companySettings?.phone ? ` at ${companySettings.phone}` : ""} if you have any questions.`}
      sending={sendMutation.isPending}
      beforeSubject={termsToggle}
      pdfRefreshKey={invoice.dueDate}
      onSend={({ recipients, subject, message }) => {
        void sendMutation
          .mutateAsync({ id: invoice.id, recipients, subject, message })
          .then(() => {
            onClose();
          });
      }}
    />
  );
}
