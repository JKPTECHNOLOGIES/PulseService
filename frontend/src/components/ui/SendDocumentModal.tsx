import { useEffect, useState } from "react";
import { PencilIcon, PlusIcon } from "@heroicons/react/24/outline";
import Modal from "./Modal";
import Button from "./Button";
import IconButton from "./IconButton";
import Spinner from "./Spinner";
import api from "../../lib/api";
import { useCustomer } from "../../hooks/useCustomers";

interface Recipient {
  email: string;
  label: string;
}

/** A row in the "Edit Email Recipients" dialog - either one of the
 * customer's known contacts, or a freeform address the sender typed in. */
interface RecipientRow {
  email: string;
  label: string;
  selected: boolean;
}

export interface SendDocumentModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Modal title, e.g. "Print / Email Invoice" / "Print / Email Quote". */
  title: string;
  /** API path for the same PDF the customer would receive, e.g.
   * `/invoices/{id}/pdf`. */
  pdfPath: string;
  /** Used for the iframe's accessible title. */
  pdfPreviewLabel: string;
  /** Small hint shown above the message box, e.g.
   * "Invoice-INV-1006.pdf will be attached". */
  attachmentHint: string;
  customerId: string;
  defaultSubject: string;
  defaultMessage: string;
  sending: boolean;
  onSend: (payload: {
    recipients: string[];
    subject: string;
    message: string;
  }) => void;
}

/**
 * Shared "Print / Email {document}" dialog: a live PDF preview (the same
 * document the customer would receive) next to an editable "To" field, plus
 * an editable Subject/Message that accompanies the PDF attachment. A
 * customer often has more than one contact on file (e.g. an
 * accounts-payable inbox plus a couple of individual contacts), and the
 * sender may also want to loop in someone not on file at all - the "Edit
 * Email Recipients" sub-dialog handles both: check/uncheck known contacts,
 * or add a brand new address.
 *
 * Used by both the Invoice and Quote (Estimate) detail pages -- the caller
 * owns the actual send mutation and default subject/message wording (each
 * document type's default message differs), this component owns the shared
 * UI/recipient-management plumbing.
 */
export default function SendDocumentModal({
  isOpen,
  onClose,
  title,
  pdfPath,
  pdfPreviewLabel,
  attachmentHint,
  customerId,
  defaultSubject,
  defaultMessage,
  sending,
  onSend,
}: SendDocumentModalProps) {
  // The parent document's own `customer` include often doesn't carry
  // contacts, so fetch the full customer record (which does) here.
  const { data: customer } = useCustomer(customerId);

  const primaryEmail = customer?.email;
  const primaryName =
    customer?.companyName ??
    `${customer?.firstName ?? ""} ${customer?.lastName ?? ""}`.trim();

  const knownRecipients: Recipient[] = [];
  if (primaryEmail) {
    knownRecipients.push({
      email: primaryEmail,
      label: primaryName || "Primary",
    });
  }
  for (const contact of customer?.contacts ?? []) {
    if (!contact.email) continue;
    const name = `${contact.firstName} ${contact.lastName}`.trim();
    const label = contact.role
      ? name
        ? `${contact.role} \u2013 ${name}`
        : contact.role
      : name || "Contact";
    knownRecipients.push({ email: contact.email, label });
  }
  // A contact's email might duplicate the customer's own - keep one entry.
  const seen = new Set<string>();
  const uniqueKnownRecipients = knownRecipients.filter((r) => {
    const key = r.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const [recipientRows, setRecipientRows] = useState<RecipientRow[]>([]);
  const [editRecipientsOpen, setEditRecipientsOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  // Reset on (re)open, defaulting to the primary email - matches the
  // previous one-click "Send" behavior when nothing else is chosen - plus a
  // pre-filled subject/message the sender can edit before sending.
  const [wasOpen, setWasOpen] = useState(false);
  if (isOpen && !wasOpen) {
    setWasOpen(true);
    setRecipientRows(
      uniqueKnownRecipients.map((r) => ({
        ...r,
        selected: r.email.toLowerCase() === primaryEmail?.toLowerCase(),
      })),
    );
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
      .get<Blob>(pdfPath, { responseType: "blob" })
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
  }, [isOpen, pdfPath]);

  if (!isOpen) return null;

  const selectedEmails = recipientRows
    .filter((r) => r.selected && r.email.trim())
    .map((r) => r.email.trim());

  const submit = () => {
    onSend({ recipients: selectedEmails, subject, message });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="2xl">
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
                title={pdfPreviewLabel}
                className="w-full h-full"
              />
            ) : null}
          </div>

          {/* To field - shows who's currently selected; editing recipients
              (checking/unchecking known contacts, or adding a new address)
              happens in the "Edit Email Recipients" sub-dialog. */}
          <div className="w-full sm:w-72 shrink-0 flex flex-col">
            <p className="text-sm font-medium text-gray-700 mb-1.5">To</p>
            <div className="flex items-start gap-2">
              <div
                className="flex-1 min-h-[42px] px-3.5 py-2.5 border border-gray-200 rounded-lg bg-gray-50 text-sm text-gray-700"
                title={selectedEmails.join(", ") || undefined}
              >
                {selectedEmails.length > 0 ? (
                  <span className="line-clamp-3 break-words">
                    {selectedEmails.join(", ")}
                  </span>
                ) : (
                  <span className="text-gray-400">No recipients selected</span>
                )}
              </div>
              <IconButton
                label="Edit email recipients"
                onClick={() => {
                  setEditRecipientsOpen(true);
                }}
                className="border border-gray-200 text-primary-600 hover:text-primary-700 hover:bg-primary-50 shrink-0"
              >
                <PencilIcon className="h-4 w-4" />
              </IconButton>
            </div>
            {uniqueKnownRecipients.length === 0 && (
              <p className="text-xs text-gray-400 mt-1.5">
                This customer has no email address on file - add one to send.
              </p>
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
            <span className="text-xs text-gray-400">{attachmentHint}</span>
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
            loading={sending}
            disabled={selectedEmails.length === 0}
            onClick={submit}
          >
            Send Email
          </Button>
        </div>
      </div>

      <EditRecipientsModal
        isOpen={editRecipientsOpen}
        initialRows={recipientRows}
        onCancel={() => {
          setEditRecipientsOpen(false);
        }}
        onSave={(rows) => {
          setRecipientRows(rows);
          setEditRecipientsOpen(false);
        }}
      />
    </Modal>
  );
}

function EditRecipientsModal({
  isOpen,
  initialRows,
  onCancel,
  onSave,
}: {
  isOpen: boolean;
  initialRows: RecipientRow[];
  onCancel: () => void;
  onSave: (rows: RecipientRow[]) => void;
}) {
  const [rows, setRows] = useState<RecipientRow[]>([]);

  // Take a fresh working copy of the current selection every time this
  // dialog opens, so Cancel never leaks edits back to the parent.
  const [wasOpen, setWasOpen] = useState(false);
  if (isOpen && !wasOpen) {
    setWasOpen(true);
    setRows(initialRows);
  }
  if (!isOpen && wasOpen) setWasOpen(false);

  if (!isOpen) return null;

  const updateRow = (index: number, patch: Partial<RecipientRow>) => {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  };

  const addRow = () => {
    setRows((prev) => [...prev, { email: "", label: "", selected: true }]);
  };

  const save = () => {
    // Drop blank ad-hoc rows the sender added but never filled in, and
    // de-dupe by address (keeping the most recently edited label/selection).
    const byEmail = new Map<string, RecipientRow>();
    for (const r of rows) {
      const email = r.email.trim();
      if (!email) continue;
      byEmail.set(email.toLowerCase(), { ...r, email });
    }
    onSave([...byEmail.values()]);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title="Edit Email Recipients"
      size="lg"
      nested
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Add and select contacts to receive this document. All items with an{" "}
          <span className="text-red-500">*</span> are mandatory fields.
        </p>

        <div className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-2 items-center">
          <span />
          <label className="text-sm font-medium text-gray-700">
            Email Address <span className="text-red-500">*</span>
          </label>
          <label className="text-sm font-medium text-gray-700">
            Email Label
          </label>

          {rows.map((row, i) => (
            <div key={i} className="contents">
              <input
                type="checkbox"
                checked={row.selected}
                onChange={(e) => {
                  updateRow(i, { selected: e.target.checked });
                }}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                aria-label={`Include ${row.email || "this address"}`}
              />
              <input
                type="email"
                value={row.email}
                placeholder="Type Here"
                onChange={(e) => {
                  updateRow(i, { email: e.target.value });
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              <input
                type="text"
                value={row.label}
                placeholder="Type Here"
                onChange={(e) => {
                  updateRow(i, { label: e.target.value });
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-700"
        >
          <PlusIcon className="h-4 w-4" />
          Add Email
        </button>

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
