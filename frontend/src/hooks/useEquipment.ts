import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse, Equipment, PaginatedResponse } from "../types";
import toast from "../lib/toast";

interface EquipmentParams {
  page?: number;
  limit?: number;
  search?: string;
  customerId?: string;
  condition?: string;
  warranty?: string;
}

export function useEquipmentList(params: EquipmentParams = {}) {
  return useQuery({
    queryKey: ["equipment", params],
    queryFn: () => api.get<PaginatedResponse<Equipment>>("/equipment", { params }),
  });
}

export function useEquipmentItem(id: string) {
  return useQuery({
    queryKey: ["equipment-item", id],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Equipment>>(`/equipment/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreateEquipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Equipment>) =>
      api.post<ApiResponse<Equipment>>("/equipment", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["equipment"] });
      toast.success("Equipment added");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to add equipment"));
    },
  });
}

export function useUpdateEquipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<Equipment> & { id: string }) =>
      api.put<ApiResponse<Equipment>>(`/equipment/${id}`, payload),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["equipment"] });
      void qc.invalidateQueries({ queryKey: ["equipment-item", vars.id] });
      toast.success("Equipment updated");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update equipment"));
    },
  });
}

export function useDeleteEquipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<ApiResponse<null>>(`/equipment/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["equipment"] });
      toast.success("Equipment deleted");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to delete equipment"));
    },
  });
}
