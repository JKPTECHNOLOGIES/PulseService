import { useEffect, useState } from "react";
import Modal from "./Modal";
import Button from "./Button";
import Spinner from "./Spinner";
import api from "../../lib/api";
import { useCustomer } from "../../hooks/useCustomers";
import { useSendInvoice } from "../../hooks/useInvoices";
import { useCompanySettings } from "../../hooks/useSettings";
import type { Invoice } from "../../types";

interface Props {
  isOpen: boolean;
  invoice: Invoice;
  onClose: () => void;
}

interface Recipient {
  email: string;
  label: string;
}

/**
 * "Print / Email Invoice" dialog: a live PDF preview (the same document the
 * customer would receive) next to a "Send To" picker. A customer often has
 * more than one contact on file (e.g. an accounts-payable inbox plus a
 * couple of individual contacts) - this lets the sender see exactly what's
 * being sent and choose exactly who gets it, instead of blindly emailing
 * only the customer's primary address.
 */
export default function SendInvoiceModal({ isOpen, invoice, onClose }: Props) {
  const sendMutation = useSendInvoice();
  // The invoice's own `customer` include doesn't carry contacts, so fetch
  // the full customer record (which does) separately.
  const { data: customer } = useCustomer(invoice.customerId);
  const { data: companySettings } = useCompanySettings();

  const primaryEmail = invoice.customer?.email ?? customer?.email;
  const primaryName =
    invoice.customer?.companyName ??
    `${invoice.customer?.firstName ?? ""} ${invoice.customer?.lastName ?? ""}`.trim();

  const recipients: Recipient[] = [];
  if (primaryEmail) {
    recipients.push({ email: primaryEmail, label: primaryName || "Primary" });
  }
  for (const contact of customer?.contacts ?? []) {
    if (!contact.email) continue;
    const name = `${contact.firstName} ${contact.lastName}`.trim();
    const label = contact.role
      ? name
        ? `${contact.role} \u2013 ${name}`
        : contact.role
      : name || "Contact";
    recipients.push({ email: contact.email, label });
  }
  // A contact's email might duplicate the customer's own - keep one entry.
  const seen = new Set<string>();
  const uniqueRecipients = recipients.filter((r) => {
    const key = r.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const defaultSubject = "Your Invoice is Ready";
  const defaultMessage = `Hello ${primaryName || "there"}, your invoice ${invoice.invoiceNumber} is attached to this message and is ready for review. Please contact the office${companySettings?.phone ? ` at ${companySettings.phone}` : ""} if you have any questions.`;

  // Reset on (re)open, defaulting to the primary email - matches the
  // previous one-click "Send" behavior when nothing else is chosen - plus a
  // pre-filled subject/message the sender can edit before sending.
  const [wasOpen, setWasOpen] = useState(false);
  if (isOpen && !wasOpen) {
    setWasOpen(true);
    setSelected(new Set(primaryEmail ? [primaryEmail] : []));
    setSubject(defaultSubject);
    setMessage(defaultMessage);
  }
  if (!isOpen && wasOpen) setWasOpen(false);

  // Fetch the same PDF the customer would receive and preview it inline
  // (via the browser's built-in PDF viewer) so the sender can see exactly
  // what's going out before emailing it.
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setPdfUrl(null);
    setPdfError(false);
    setPdfLoading(true);
    api
      .get<Blob>(`/invoices/${invoice.id}/pdf`, { responseType: "blob" })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPdfUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setPdfError(true);
      })
      .finally(() => {
        if (!cancelled) setPdfLoading(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [isOpen, invoice.id]);

  if (!isOpen) return null;

  const toggle = (email: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(email)) next.delete(email);
      else next.add(email);
      return next;
    });
  };

  const submit = () => {
    void sendMutation
      .mutateAsync({
        id: invoice.id,
        recipients: [...selected],
        subject,
        message,
      })
      .then(() => {
        onClose();
      });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Print / Email Invoice"
      size="2xl"
    >
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row gap-5">
          {/* PDF preview - the exact document that will be attached. */}
          <div className="flex-1 min-w-0 h-[35vh] sm:h-[45vh] rounded-lg border border-gray-200 bg-gray-50 overflow-hidden flex items-center justify-center">
            {pdfLoading ? (
              <Spinner className="h-8 w-8 text-primary-600" />
            ) : pdfError ? (
              <p className="text-sm text-gray-400 px-6 text-center">
                Couldn't load the PDF preview.
              </p>
            ) : pdfUrl ? (
              <iframe
                src={pdfUrl}
                title={`Invoice ${invoice.invoiceNumber} preview`}
                className="w-full h-full"
              />
            ) : null}
          </div>

          {/* Send To picker */}
          <div className="w-full sm:w-72 shrink-0 flex flex-col">
            <p className="text-sm font-medium text-gray-700 mb-2">Send To</p>
            {uniqueRecipients.length === 0 ? (
              <p className="text-sm text-gray-400">
                This customer has no email address on file.
              </p>
            ) : (
              <div className="flex-1 max-h-64 sm:max-h-none overflow-y-auto rounded-lg border border-gray-100 divide-y divide-gray-50">
                {uniqueRecipients.map((r) => (
                  <label
                    key={r.email}
                    className="flex items-start gap-3 px-3 py-2.5 cursor-pointer hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(r.email)}
                      onChange={() => {
                        toggle(r.email);
                      }}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm text-gray-900 truncate">
                        {r.email}
                      </span>
                      <span className="block text-xs text-gray-500">
                        {r.label}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Subject + message - the PDF is attached alongside this, not sent as
            the entire email; both are pre-filled but fully editable before
            sending. */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Subject
          </label>
          <input
            type="text"
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
            }}
            className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-gray-700">
              Message
            </label>
            <span className="text-xs text-gray-400">
              {invoice.invoiceNumber
                ? `Invoice-${invoice.invoiceNumber}.pdf will be attached`
                : "Invoice PDF will be attached"}
            </span>
          </div>
          <textarea
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
            }}
            rows={5}
            className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-y"
          />
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={sendMutation.isPending}
            disabled={selected.size === 0}
            onClick={submit}
          >
            Send Email
          </Button>
        </div>
      </div>
    </Modal>
  );
}
