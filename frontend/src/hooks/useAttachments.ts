import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse, Attachment, AttachmentEntityType } from "../types";
import toast from "react-hot-toast";

const key = (entityType: AttachmentEntityType, entityId: string) =>
  ["attachments", entityType, entityId] as const;

export function useAttachments(
  entityType: AttachmentEntityType,
  entityId: string | undefined,
) {
  return useQuery({
    queryKey: key(entityType, entityId ?? ""),
    queryFn: async () => {
      const res = await api.get<ApiResponse<Attachment[]>>("/attachments", {
        params: { entityType, entityId },
      });
      return res.data;
    },
    enabled: !!entityId,
  });
}

export function useUploadAttachment(
  entityType: AttachmentEntityType,
  entityId: string,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ file, caption }: { file: File; caption?: string }) => {
      const form = new FormData();
      form.append("file", file);
      form.append("entityType", entityType);
      form.append("entityId", entityId);
      if (caption) form.append("caption", caption);
      // axios detects the FormData body and sets the multipart boundary itself.
      return api.post<ApiResponse<Attachment>>("/attachments", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: key(entityType, entityId) });
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
      void qc.invalidateQueries({ queryKey: key(entityType, entityId) });
      toast.success("Photo deleted");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to delete photo"));
    },
  });
}
