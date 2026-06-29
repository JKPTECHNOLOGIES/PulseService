import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse, Estimate, PaginatedResponse } from "../types";
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
      toast.success("Estimate created successfully");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to create estimate"));
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
      toast.success("Estimate updated successfully");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update estimate"));
    },
  });
}

export function useSendEstimate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<ApiResponse<Estimate>>(`/estimates/${id}/send`),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ["estimate", id] });
      void qc.invalidateQueries({ queryKey: ["estimates"] });
      toast.success("Estimate sent to customer");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to send estimate"));
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
      toast.success("Estimate approved");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to approve estimate"));
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
      toast.success("Estimate converted to invoice");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to convert estimate"));
    },
  });
}
