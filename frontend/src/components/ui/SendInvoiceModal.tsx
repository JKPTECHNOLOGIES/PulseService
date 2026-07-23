import SendDocumentModal from "./SendDocumentModal";
import { useSendInvoice } from "../../hooks/useInvoices";
import { useCompanySettings } from "../../hooks/useSettings";
import type { Invoice } from "../../types";

interface Props {
  isOpen: boolean;
  invoice: Invoice;
  onClose: () => void;
}

/** "Print / Email Invoice" dialog - see SendDocumentModal for the shared UI. */
export default function SendInvoiceModal({ isOpen, invoice, onClose }: Props) {
  const sendMutation = useSendInvoice();
  const { data: companySettings } = useCompanySettings();

  const primaryName =
    invoice.customer?.companyName ??
    `${invoice.customer?.firstName ?? ""} ${invoice.customer?.lastName ?? ""}`.trim();

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
