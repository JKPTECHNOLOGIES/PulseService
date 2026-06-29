import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse, Invoice, PaginatedResponse } from "../types";
import toast from "react-hot-toast";

interface InvoicesParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  customerId?: string;
}

export function useInvoices(params: InvoicesParams = {}) {
  return useQuery({
    queryKey: ["invoices", params],
    queryFn: () => api.get<PaginatedResponse<Invoice>>("/invoices", { params }),
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

export function useSendInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<ApiResponse<Invoice>>(`/invoices/${id}/send`),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ["invoice", id] });
      void qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice sent to customer");
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
    mutationFn: (id: string) =>
      api.patch<ApiResponse<Invoice>>(`/invoices/${id}/void`),
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
