import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse, Supplier } from "../types";
import toast from "../lib/toast";

export function useSuppliers(params: { search?: string; active?: string } = {}) {
  return useQuery({
    queryKey: ["suppliers", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Supplier[]>>("/suppliers", { params });
      return res.data;
    },
  });
}

export function useSupplier(id: string) {
  return useQuery({
    queryKey: ["suppliers", "detail", id],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Supplier>>(`/suppliers/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useSaveSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<Supplier> & { id?: string }) =>
      id
        ? api.put<ApiResponse<Supplier>>(`/suppliers/${id}`, payload)
        : api.post<ApiResponse<Supplier>>("/suppliers", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Supplier saved");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to save supplier"));
    },
  });
}

export function useDeleteSupplier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/suppliers/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["suppliers"] });
      toast.success("Supplier deactivated");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to deactivate supplier"));
    },
  });
}
