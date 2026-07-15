import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse, Vendor } from "../types";
import toast from "../lib/toast";

export function useVendors(params: { search?: string; active?: string } = {}) {
  return useQuery({
    queryKey: ["vendors", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Vendor[]>>("/vendors", { params });
      return res.data;
    },
  });
}

export function useVendor(id: string) {
  return useQuery({
    queryKey: ["vendors", "detail", id],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Vendor>>(`/vendors/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useSaveVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<Vendor> & { id?: string }) =>
      id
        ? api.put<ApiResponse<Vendor>>(`/vendors/${id}`, payload)
        : api.post<ApiResponse<Vendor>>("/vendors", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["vendors"] });
      toast.success("Vendor saved");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to save vendor"));
    },
  });
}

export function useDeleteVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/vendors/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["vendors"] });
      toast.success("Vendor deactivated");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to deactivate vendor"));
    },
  });
}
