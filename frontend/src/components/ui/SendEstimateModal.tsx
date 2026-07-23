import SendDocumentModal from "./SendDocumentModal";
import { useSendEstimate } from "../../hooks/useEstimates";
import { useCompanySettings } from "../../hooks/useSettings";
import type { Estimate } from "../../types";

interface Props {
  isOpen: boolean;
  estimate: Estimate;
  onClose: () => void;
}

/** "Print / Email Quote" dialog - see SendDocumentModal for the shared UI.
 * The customer's online approve/reject link is always appended by the
 * backend regardless of the edited message, so it can't accidentally be
 * edited away. */
export default function SendEstimateModal({
  isOpen,
  estimate,
  onClose,
}: Props) {
  const sendMutation = useSendEstimate();
  const { data: companySettings } = useCompanySettings();

  const primaryName =
    estimate.customer?.companyName ??
    `${estimate.customer?.firstName ?? ""} ${estimate.customer?.lastName ?? ""}`.trim();

  return (
    <SendDocumentModal
      isOpen={isOpen}
      onClose={onClose}
      title="Print / Email Quote"
      pdfPath={`/estimates/${estimate.id}/pdf`}
      pdfPreviewLabel={`Quote ${estimate.estimateNumber} preview`}
      attachmentHint={`Estimate-${estimate.estimateNumber}.pdf will be attached`}
      customerId={estimate.customerId}
      defaultSubject="Your Quote is Ready"
      defaultMessage={`Hello ${primaryName || "there"}, your quote ${estimate.estimateNumber} is attached to this message and is ready for your review. You can approve or reject it using the secure link below. Please contact the office${companySettings?.phone ? ` at ${companySettings.phone}` : ""} if you have any questions.`}
      sending={sendMutation.isPending}
      onSend={({ recipients, subject, message }) => {
        void sendMutation
          .mutateAsync({ id: estimate.id, recipients, subject, message })
          .then(() => {
            onClose();
          });
      }}
    />
  );
}
