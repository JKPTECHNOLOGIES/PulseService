import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { Invoice, PaginatedResponse } from "../types";
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
    queryFn: async () => {
      const data = await api.get("/invoices", { params });
      return data as unknown as PaginatedResponse<Invoice>;
    },
  });
}

export function useInvoice(id: string) {
  return useQuery({
    queryKey: ["invoice", id],
    queryFn: async () => {
      const data = await api.get(`/invoices/${id}`);
      return (data as any).data as Invoice;
    },
    enabled: !!id,
  });
}

export function useCreateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Invoice> & { lineItems?: any[] }) =>
      api.post("/invoices", payload) as Promise<any>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice created successfully");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to create invoice");
    },
  });
}

export function useUpdateInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: Partial<Invoice> & { id: string; lineItems?: any[] }) =>
      api.put(`/invoices/${id}`, payload) as Promise<any>,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["invoice", vars.id] });
      toast.success("Invoice updated successfully");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to update invoice");
    },
  });
}

export function useSendInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post(`/invoices/${id}/send`) as Promise<any>,
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["invoice", id] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice sent to customer");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to send invoice");
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
    }) => api.post(`/invoices/${invoiceId}/payments`, payload) as Promise<any>,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["invoice", vars.invoiceId] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["payments"] });
      toast.success("Payment recorded successfully");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to record payment");
    },
  });
}

export function useVoidInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.patch(`/invoices/${id}/void`) as Promise<any>,
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["invoice", id] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Invoice voided");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to void invoice");
    },
  });
}
