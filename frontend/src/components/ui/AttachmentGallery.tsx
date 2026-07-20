import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, Transition } from "@headlessui/react";
import {
  PhotoIcon,
  ArrowUpTrayIcon,
  TrashIcon,
  XMarkIcon,
  ClockIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import api from "../../lib/api";
import {
  useAttachments,
  useUploadAttachment,
  useDeleteAttachment,
} from "../../hooks/useAttachments";
import {
  usePendingUploads,
  removePendingUpload,
} from "../../hooks/useOfflineUploads";
import type { Attachment, AttachmentEntityType } from "../../types";
import Spinner from "./Spinner";
import ConfirmDialog from "./ConfirmDialog";

// Local preview for a queued (not-yet-uploaded) file -- there's no server id
// to fetch yet, so this reads the File directly via an object URL.
function PendingImage({ file }: { file: File }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => {
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [url]);
  return <img src={url} alt={file.name} className="h-full w-full object-cover" />;
}

interface AttachmentGalleryProps {
  entityType: AttachmentEntityType;
  entityId: string;
  title?: string;
}

/**
 * Fetches an attachment's bytes through the authenticated API and renders them
 * as an <img>. The binary endpoint requires the auth header, so we can't point
 * <img src> straight at it — we fetch a blob and use an object URL instead. The
 * object URL is revoked on unmount to avoid leaking memory.
 */
function AttachmentImage({
  id,
  alt,
  className,
}: {
  id: string;
  alt: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string>();

  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    api
      .get<Blob>(`/attachments/${id}/raw`, { responseType: "blob" })
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        /* thumbnail simply stays in its loading state on error */
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  if (!url) {
    return (
      <div
        className={clsx(
          "flex items-center justify-center bg-gray-100 animate-pulse",
          className,
        )}
      >
        <PhotoIcon className="h-6 w-6 text-gray-300" />
      </div>
    );
  }

  return <img src={url} alt={alt} className={className} />;
}

export default function AttachmentGallery({
  entityType,
  entityId,
  title = "Photos & Attachments",
}: AttachmentGalleryProps) {
  const { data: attachments, isLoading } = useAttachments(entityType, entityId);
  const upload = useUploadAttachment(entityType, entityId);
  const del = useDeleteAttachment(entityType, entityId);
  const pendingUploads = usePendingUploads(entityType, entityId);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [preview, setPreview] = useState<Attachment | null>(null);
  const [toDelete, setToDelete] = useState<Attachment | null>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      upload.mutate({ file });
    });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const items = attachments ?? [];

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={upload.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {upload.isPending ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <ArrowUpTrayIcon className="h-4 w-4" />
          )}
          Add photo
        </button>
        {/*
          accept="image/*" lets mobile browsers offer both the camera and the
          photo library; multiple allows batch uploads from desktop.
        */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFiles(e.target.files);
          }}
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner className="h-6 w-6 text-primary-600" />
        </div>
      ) : items.length === 0 && pendingUploads.length === 0 ? (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-200 py-8 text-gray-400 hover:border-primary-300 hover:text-primary-500 transition-colors"
        >
          <PhotoIcon className="h-8 w-8" />
          <span className="text-xs font-medium">
            No photos yet — tap to add one
          </span>
        </button>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
          {/* Queued uploads: captured offline, not yet on the server. Shown
              first so what's still pending is immediately visible. */}
          {pendingUploads.map((pending) => (
            <div
              key={pending.id}
              className="group relative aspect-square overflow-hidden rounded-lg border border-amber-200 bg-gray-50"
            >
              <PendingImage file={pending.file} />
              <div
                className={clsx(
                  "absolute left-1 top-1 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium text-oncolor",
                  pending.status === "error" ? "bg-red-600" : "bg-amber-500",
                )}
                title={
                  pending.status === "error"
                    ? (pending.error ?? "Failed to sync")
                    : "Will upload when back online"
                }
              >
                <ClockIcon className="h-3 w-3" />
                {pending.status === "error" ? "Failed" : "Queued"}
              </div>
              <button
                type="button"
                onClick={() => {
                  void removePendingUpload(pending.id);
                }}
                title="Discard"
                aria-label="Discard queued photo"
                className="absolute right-1 top-1 rounded-full bg-black/50 p-2 text-oncolor transition-opacity opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
          {items.map((att) => (
            <div
              key={att.id}
              className="group relative aspect-square overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
            >
              <button
                type="button"
                onClick={() => {
                  setPreview(att);
                }}
                className="block h-full w-full"
              >
                <AttachmentImage
                  id={att.id}
                  alt={att.caption ?? att.filename}
                  className="h-full w-full object-cover"
                />
              </button>
              <button
                type="button"
                onClick={() => {
                  setToDelete(att);
                }}
                title="Delete photo"
                aria-label="Delete photo"
                className="absolute right-1 top-1 rounded-full bg-black/50 p-2 text-oncolor transition-opacity opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Full-size preview in an accessible dialog (focus trap + Escape + aria,
          via Headless UI). It's portaled to <body>, so it escapes any
          transformed/overflow-hidden ancestor and the image is never clipped. */}
      <Transition show={preview !== null} as={Fragment}>
        <Dialog
          onClose={() => {
            setPreview(null);
          }}
          className="relative z-[60]"
        >
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/80" aria-hidden="true" />
          </Transition.Child>

          <div className="fixed inset-0 flex items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-200"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-150"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="flex max-h-full max-w-full flex-col items-center">
                {preview && (
                  <AttachmentImage
                    id={preview.id}
                    alt={preview.caption ?? preview.filename}
                    className="h-auto w-auto max-h-[85vh] max-w-[92vw] rounded-lg object-contain"
                  />
                )}
                {preview?.caption && (
                  <p className="mt-2 max-w-[92vw] text-center text-sm text-oncolor/80">
                    {preview.caption}
                  </p>
                )}
              </Dialog.Panel>
            </Transition.Child>

            <button
              type="button"
              onClick={() => {
                setPreview(null);
              }}
              aria-label="Close preview"
              className="absolute right-4 top-4 z-10 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-oncolor/10 p-2 text-oncolor hover:bg-oncolor/20"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>
        </Dialog>
      </Transition>

      <ConfirmDialog
        isOpen={!!toDelete}
        onClose={() => {
          setToDelete(null);
        }}
        onConfirm={() => {
          if (toDelete) del.mutate(toDelete.id);
          setToDelete(null);
        }}
        title="Delete photo"
        message="Are you sure you want to delete this photo? This cannot be undone."
        confirmLabel="Delete"
        loading={del.isPending}
      />
    </div>
  );
}
