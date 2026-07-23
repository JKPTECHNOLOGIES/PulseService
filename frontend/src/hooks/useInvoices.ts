import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse, Invoice, PaginatedResponse } from "../types";
import toast from "../lib/toast";

interface InvoicesParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  customerId?: string;
  letter?: string;
}

// The list response also carries grand totals for the whole filtered set (all
// pages), used for the totals row under the table.
type InvoicesResponse = PaginatedResponse<Invoice> & {
  summary?: { total: number; balance: number };
};

export function useInvoices(params: InvoicesParams = {}) {
  return useQuery({
    queryKey: ["invoices", params],
    queryFn: () => api.get<InvoicesResponse>("/invoices", { params }),
  });
}

export interface InvoiceStats {
  total: number;
  byStatus: Record<string, number>;
}

export function useInvoiceStats() {
  return useQuery({
    queryKey: ["invoices", "stats"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<InvoiceStats>>("/invoices/stats");
      return res.data;
    },
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: ["invoice", id],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Invoice>>(`/invoices/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Invoice> & { lineItems?: unknown[] }) =>
      api.post<ApiResponse<Invoice>>("/invoices", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice created successfully");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to create invoice"));
    },
  });
}

export function useUpdateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: Partial<Invoice> & { id: string; lineItems?: unknown[] }) =>
      api.put<ApiResponse<Invoice>>(`/invoices/${id}`, payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      void qc.invalidateQueries({ queryKey: ["invoice", vars.id] });
      toast.success("Invoice updated successfully");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update invoice"));
    },
  });
}

interface SendResult {
  success: boolean;
  data: Invoice;
  emailPreviewUrl?: string | null;
  emailWarning?: string | null;
}

export function useSendInvoice() {
  const qc = useQueryClient();
  return useMutation({
    // `recipients` lets the "Send To" picker choose specific addresses (e.g. a
    // billing contact); omitting it falls back to the customer's primary email.
    mutationFn: ({ id, recipients }: { id: string; recipients?: string[] }) =>
      api.post<SendResult>(`/invoices/${id}/send`, { recipients }),
    onSuccess: (res, { id }) => {
      void qc.invalidateQueries({ queryKey: ["invoice", id] });
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      if (res.emailWarning) {
        toast(res.emailWarning, { icon: "\u26A0\uFE0F", duration: 6000 });
      } else {
        toast.success("Invoice emailed to customer");
      }
      // In demo mode (no real SMTP) the backend returns an Ethereal preview URL
      // so you can see the email that would have been delivered.
      if (res.emailPreviewUrl) {
        window.open(res.emailPreviewUrl, "_blank", "noopener");
      }
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to send invoice"));
    },
  });
}

export function useRecordPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      invoiceId,
      ...payload
    }: {
      invoiceId: string;
      amount: number;
      method: string;
      referenceNumber?: string;
      notes?: string;
    }) =>
      api.post<ApiResponse<Invoice>>(
        `/invoices/${invoiceId}/payments`,
        payload,
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["invoice", vars.invoiceId] });
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      void qc.invalidateQueries({ queryKey: ["payments"] });
      toast.success("Payment recorded successfully");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to record payment"));
    },
  });
}

export function useVoidInvoice() {
  const qc = useQueryClient();
  return useMutation({
    // NB: the backend route is POST (matching /send and /payments in the same
    // file), not PATCH -- this used to be a PATCH call, which silently 404'd
    // against the real route no matter who called it.
    mutationFn: (id: string) =>
      api.post<ApiResponse<Invoice>>(`/invoices/${id}/void`),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ["invoice", id] });
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice voided");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to void invoice"));
    },
  });
}

export function useReversePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ paymentId }: { paymentId: string; invoiceId: string }) =>
      api.post<ApiResponse<{ payment: unknown; invoice: Invoice }>>(
        `/payments/${paymentId}/reverse`,
      ),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["invoice", vars.invoiceId] });
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      void qc.invalidateQueries({ queryKey: ["payments"] });
      toast.success("Payment reversed");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to reverse payment"));
    },
  });
}
