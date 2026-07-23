import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse, Estimate, PaginatedResponse } from "../types";
import toast from "../lib/toast";

interface EstimatesParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  customerId?: string;
}

export function useEstimates(params: EstimatesParams = {}) {
  return useQuery({
    queryKey: ["estimates", params],
    queryFn: () =>
      api.get<PaginatedResponse<Estimate>>("/estimates", { params }),
  });
}

export function useEstimate(id: string) {
  return useQuery({
    queryKey: ["estimate", id],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Estimate>>(`/estimates/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreateEstimate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Estimate> & { lineItems?: unknown[] }) =>
      api.post<ApiResponse<Estimate>>("/estimates", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["estimates"] });
      toast.success("Quote created successfully");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to create quote"));
    },
  });
}

export function useUpdateEstimate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: Partial<Estimate> & { id: string; lineItems?: unknown[] }) =>
      api.put<ApiResponse<Estimate>>(`/estimates/${id}`, payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["estimates"] });
      void qc.invalidateQueries({ queryKey: ["estimate", vars.id] });
      toast.success("Quote updated successfully");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update quote"));
    },
  });
}

interface SendResult {
  success: boolean;
  data: Estimate;
  emailPreviewUrl?: string | null;
  emailWarning?: string | null;
}

export function useSendEstimate() {
  const qc = useQueryClient();
  return useMutation({
    // `recipients` lets the "Send To" picker choose specific addresses;
    // omitting it falls back to the customer's primary email. `subject`/
    // `message` are the editable email content from the preview dialog;
    // omitting them falls back to the default template (the approval link
    // is always included server-side regardless).
    mutationFn: ({
      id,
      recipients,
      subject,
      message,
    }: {
      id: string;
      recipients?: string[];
      subject?: string;
      message?: string;
    }) =>
      api.post<SendResult>(`/estimates/${id}/send`, {
        recipients,
        subject,
        message,
      }),
    onSuccess: (res, { id }) => {
      void qc.invalidateQueries({ queryKey: ["estimate", id] });
      void qc.invalidateQueries({ queryKey: ["estimates"] });
      if (res.emailWarning) {
        toast(res.emailWarning, { icon: "\u26A0\uFE0F", duration: 6000 });
      } else {
        toast.success("Quote emailed to customer");
      }
      // Demo mode (no real SMTP): open the Ethereal preview of the sent email.
      if (res.emailPreviewUrl) {
        window.open(res.emailPreviewUrl, "_blank", "noopener");
      }
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to send quote"));
    },
  });
}

export function useApproveEstimate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<ApiResponse<Estimate>>(`/estimates/${id}/approve`),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ["estimate", id] });
      void qc.invalidateQueries({ queryKey: ["estimates"] });
      toast.success("Quote approved");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to approve quote"));
    },
  });
}

export function useConvertToInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<ApiResponse<Estimate>>(`/estimates/${id}/convert`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["estimates"] });
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Quote converted to invoice");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to convert quote"));
    },
  });
}
