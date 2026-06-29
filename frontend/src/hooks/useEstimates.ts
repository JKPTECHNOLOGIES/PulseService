import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { Estimate, PaginatedResponse } from "../types";
import toast from "react-hot-toast";

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
    queryFn: async () => {
      const data = await api.get("/estimates", { params });
      return data as unknown as PaginatedResponse<Estimate>;
    },
  });
}

export function useEstimate(id: string) {
  return useQuery({
    queryKey: ["estimate", id],
    queryFn: async () => {
      const data = await api.get(`/estimates/${id}`);
      return (data as any).data as Estimate;
    },
    enabled: !!id,
  });
}

export function useCreateEstimate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Estimate> & { lineItems?: any[] }) =>
      api.post("/estimates", payload) as Promise<any>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["estimates"] });
      toast.success("Estimate created successfully");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to create estimate");
    },
  });
}

export function useUpdateEstimate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: Partial<Estimate> & { id: string; lineItems?: any[] }) =>
      api.put(`/estimates/${id}`, payload) as Promise<any>,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["estimates"] });
      qc.invalidateQueries({ queryKey: ["estimate", vars.id] });
      toast.success("Estimate updated successfully");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to update estimate");
    },
  });
}

export function useSendEstimate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post(`/estimates/${id}/send`) as Promise<any>,
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["estimate", id] });
      qc.invalidateQueries({ queryKey: ["estimates"] });
      toast.success("Estimate sent to customer");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to send estimate");
    },
  });
}

export function useApproveEstimate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post(`/estimates/${id}/approve`) as Promise<any>,
    onSuccess: (_data, id) => {
      qc.invalidateQueries({ queryKey: ["estimate", id] });
      qc.invalidateQueries({ queryKey: ["estimates"] });
      toast.success("Estimate approved");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to approve estimate");
    },
  });
}

export function useConvertToInvoice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post(`/estimates/${id}/convert`) as Promise<any>,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["estimates"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast.success("Estimate converted to invoice");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Failed to convert estimate");
    },
  });
}
