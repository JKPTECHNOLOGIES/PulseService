import { useRef, useState } from "react";
import {
  PencilSquareIcon,
  CheckBadgeIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import toast from "../../lib/toast";
import {
  useAttachments,
  useUploadAttachment,
} from "../../hooks/useAttachments";
import { usePendingUploads } from "../../hooks/useOfflineUploads";
import type { AttachmentEntityType } from "../../types";
import Modal from "./Modal";
import Button from "./Button";
import SignaturePad, { type SignaturePadHandle } from "./SignaturePad";

interface SignatureCardProps {
  entityType: AttachmentEntityType;
  entityId: string;
}

// Signatures are stored through the shared attachment system, tagged by a
// `signature-` filename prefix so they can be told apart from photos.
const SIGNATURE_PREFIX = "signature-";

export default function SignatureCard({
  entityType,
  entityId,
}: SignatureCardProps) {
  const { data: attachments } = useAttachments(entityType, entityId);
  const upload = useUploadAttachment(entityType, entityId);
  const pendingUploads = usePendingUploads(entityType, entityId);
  const padRef = useRef<SignaturePadHandle>(null);
  const [open, setOpen] = useState(false);

  const signatureCount = (attachments ?? []).filter((a) =>
    a.filename.startsWith(SIGNATURE_PREFIX),
  ).length;
  // Captured offline, not yet on the server -- see hooks/useOfflineUploads.ts.
  const pendingSignatureCount = pendingUploads.filter(
    (u) => u.caption === "Signature",
  ).length;

  const save = async () => {
    const pad = padRef.current;
    if (!pad || pad.isEmpty()) {
      toast.error("Please sign before saving");
      return;
    }
    const blob = await pad.toBlob();
    if (!blob) return;
    const file = new File(
      [blob],
      `${SIGNATURE_PREFIX}${String(Date.now())}.png`,
      {
        type: "image/png",
      },
    );
    upload.mutate(
      { file, caption: "Signature" },
      {
        onSuccess: () => {
          setOpen(false);
        },
      },
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Signature</h3>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          <PencilSquareIcon className="h-4 w-4" />
          Capture
        </button>
      </div>

      {signatureCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 border border-green-100 px-3 py-2 text-sm text-green-700">
          <CheckBadgeIcon className="h-5 w-5 shrink-0" />
          {signatureCount} signature{signatureCount === 1 ? "" : "s"} on file
          <span className="text-green-600/70">— view under Photos below</span>
        </div>
      )}
      {pendingSignatureCount > 0 && (
        <div
          className={clsx(
            "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
            "bg-amber-50 border-amber-100 text-amber-700",
            signatureCount > 0 && "mt-2",
          )}
        >
          <ClockIcon className="h-5 w-5 shrink-0" />
          {pendingSignatureCount} signature
          {pendingSignatureCount === 1 ? "" : "s"} queued — will upload when
          back online
        </div>
      )}
      {signatureCount === 0 && pendingSignatureCount === 0 && (
        <p className="text-xs text-gray-400">No signature captured yet.</p>
      )}

      <Modal
        isOpen={open}
        onClose={() => {
          setOpen(false);
        }}
        title="Capture Signature"
      >
        <p className="text-xs text-gray-500 mb-2">
          Sign in the box below using your finger, stylus, or mouse.
        </p>
        <SignaturePad ref={padRef} />
        <div className="flex justify-between gap-3 mt-4">
          <Button
            variant="ghost"
            type="button"
            onClick={() => {
              padRef.current?.clear();
            }}
          >
            Clear
          </Button>
          <div className="flex gap-3">
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              loading={upload.isPending}
              onClick={() => {
                void save();
              }}
            >
              Save Signature
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
