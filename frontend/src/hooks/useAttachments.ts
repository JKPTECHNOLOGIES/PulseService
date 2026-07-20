import {
  onlineManager,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import { queueUpload } from "../lib/offlineUploads";
import type { ApiResponse, Attachment, AttachmentEntityType } from "../types";
import toast from "../lib/toast";

export const attachmentsQueryKey = (
  entityType: AttachmentEntityType,
  entityId: string,
) => ["attachments", entityType, entityId] as const;

export async function fetchAttachments(
  entityType: AttachmentEntityType,
  entityId: string,
): Promise<Attachment[]> {
  const res = await api.get<ApiResponse<Attachment[]>>("/attachments", {
    params: { entityType, entityId },
  });
  return res.data;
}

export function useAttachments(
  entityType: AttachmentEntityType,
  entityId: string | undefined,
) {
  return useQuery({
    queryKey: attachmentsQueryKey(entityType, entityId ?? ""),
    queryFn: () => fetchAttachments(entityType, entityId ?? ""),
    enabled: !!entityId,
  });
}

export function useUploadAttachment(
  entityType: AttachmentEntityType,
  entityId: string,
) {
  const qc = useQueryClient();
  return useMutation({
    // Uploads carry a File, which can't survive the JSON-based offline
    // mutation queue (see lib/offlineUploads.ts for why a File can't be
    // persisted to localStorage). So this mutation handles connectivity
    // itself -- networkMode "always" stops TanStack Query from auto-pausing
    // it offline, so the branch below actually runs instead of just sitting
    // paused (which would otherwise mask the offline path entirely).
    networkMode: "always",
    mutationFn: async ({
      file,
      caption,
    }: {
      file: File;
      caption?: string;
    }) => {
      if (!onlineManager.isOnline()) {
        await queueUpload({ entityType, entityId, file, caption });
        return { queued: true as const };
      }
      const form = new FormData();
      form.append("file", file);
      form.append("entityType", entityType);
      form.append("entityId", entityId);
      if (caption) form.append("caption", caption);
      // axios detects the FormData body and sets the multipart boundary itself.
      await api.post<ApiResponse<Attachment>>("/attachments", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return { queued: false as const };
    },
    onSuccess: (result) => {
      if (result.queued) {
        toast.success("Photo saved — will upload when back online");
        return;
      }
      void qc.invalidateQueries({
        queryKey: attachmentsQueryKey(entityType, entityId),
      });
      toast.success("Photo uploaded");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to upload photo"));
    },
  });
}

export function useDeleteAttachment(
  entityType: AttachmentEntityType,
  entityId: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<ApiResponse<null>>(`/attachments/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: attachmentsQueryKey(entityType, entityId),
      });
      toast.success("Photo deleted");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to delete photo"));
    },
  });
}
