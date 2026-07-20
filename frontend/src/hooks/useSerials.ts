import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import { OFFLINE_MK } from "../lib/offlineMutations";
import type { ApiResponse, PaginatedResponse, SerializedUnit } from "../types";
import toast from "../lib/toast";

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

export function useCreateSerializedUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      serialNumber: string;
      inventoryItemId: string;
      status?: string;
      stockLocationId?: string;
      purchaseCost?: number;
      warrantyMonths?: number;
      notes?: string;
    }) => api.post<ApiResponse<SerializedUnit>>("/serials", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["serials"] });
      toast.success("Serialized unit added");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to add unit"));
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

export function useDeleteSerializedUnit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/serials/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["serials"] });
      toast.success("Serialized unit deleted");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to delete unit"));
    },
  });
}

export function useUninstallSerializedUnit() {
  const qc = useQueryClient();
  return useMutation({
    // Keyed to the offline default so removing a unit with no signal replays
    // after an app reload (see lib/offlineMutations.ts).
    mutationKey: OFFLINE_MK.uninstallSerializedUnit,
    mutationFn: (id: string) =>
      api.post<ApiResponse<SerializedUnit>>(`/serials/${id}/uninstall`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["serials"] });
      toast.success("Unit removed from job");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to remove unit"));
    },
  });
}

export function useInstallSerializedUnit() {
  const qc = useQueryClient();
  return useMutation({
    // Keyed to the offline default so installing a unit with no signal
    // replays after an app reload (see lib/offlineMutations.ts).
    mutationKey: OFFLINE_MK.installSerializedUnit,
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
