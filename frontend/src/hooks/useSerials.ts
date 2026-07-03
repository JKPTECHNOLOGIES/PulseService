import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse, PaginatedResponse, SerializedUnit } from "../types";
import toast from "react-hot-toast";

export function useSerializedUnits(
  params: {
    page?: number;
    limit?: number;
    itemId?: string;
    status?: string;
    stockLocationId?: string;
    customerId?: string;
    jobId?: string;
    search?: string;
  } = {},
) {
  return useQuery({
    queryKey: ["serials", "list", params],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<SerializedUnit>>("/serials", {
        params,
      });
      return res;
    },
  });
}

export function useUpdateSerializedUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: Partial<SerializedUnit> & { id: string }) =>
      api.put<ApiResponse<SerializedUnit>>(`/serials/${id}`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["serials"] });
      toast.success("Serialized unit updated");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update unit"));
    },
  });
}

export function useInstallSerializedUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string;
      installedCustomerId?: string;
      installedLocationId?: string;
      installedJobId?: string;
      equipmentId?: string;
      warrantyExpiresAt?: string;
    }) =>
      api.post<ApiResponse<SerializedUnit>>(`/serials/${id}/install`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["serials"] });
      toast.success("Unit marked installed");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to install unit"));
    },
  });
}
