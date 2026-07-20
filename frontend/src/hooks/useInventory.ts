import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import { OFFLINE_MK } from "../lib/offlineMutations";
import type {
  ApiResponse,
  InventoryItem,
  InventoryTransaction,
  JobPart,
  StockLocation,
  VehicleOption,
} from "../types";
import toast from "../lib/toast";

// ─── Stock locations (warehouse + trucks) ────────────────────────────────────

export function useStockLocations(
  params: { type?: string; active?: string } = {},
) {
  return useQuery({
    queryKey: ["stock-locations", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<StockLocation[]>>(
        "/stock-locations",
        {
          params,
        },
      );
      return res.data;
    },
  });
}

export function useVehicles() {
  return useQuery({
    queryKey: ["stock-locations", "vehicles"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<VehicleOption[]>>(
        "/stock-locations/vehicles",
      );
      return res.data;
    },
  });
}

export function useDeleteStockLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/stock-locations/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stock-locations"] });
      toast.success("Location deactivated");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to deactivate location"));
    },
  });
}

export function useSaveStockLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: Partial<StockLocation> & { id?: string }) =>
      id
        ? api.put<ApiResponse<StockLocation>>(`/stock-locations/${id}`, payload)
        : api.post<ApiResponse<StockLocation>>("/stock-locations", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["stock-locations"] });
      toast.success("Location saved");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to save location"));
    },
  });
}

// ─── Items ───────────────────────────────────────────────────────────────────

export function useInventoryItems(
  params: {
    search?: string;
    categoryId?: string;
    vendorId?: string;
    locationId?: string;
    lowStock?: string;
  } = {},
) {
  return useQuery({
    queryKey: ["inventory", "items", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<InventoryItem[]>>(
        "/inventory/items",
        {
          params,
        },
      );
      return res.data;
    },
  });
}

export function useInventoryItem(id: string) {
  return useQuery({
    queryKey: ["inventory", "item", id],
    queryFn: async () => {
      const res = await api.get<ApiResponse<InventoryItem>>(
        `/inventory/items/${id}`,
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useSaveInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: Partial<InventoryItem> & { id?: string }) =>
      id
        ? api.put<ApiResponse<InventoryItem>>(`/inventory/items/${id}`, payload)
        : api.post<ApiResponse<InventoryItem>>("/inventory/items", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Item saved");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to save item"));
    },
  });
}

export function useDeleteInventoryItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/inventory/items/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Item archived");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to archive item"));
    },
  });
}

// ─── Stock movements ─────────────────────────────────────────────────────────

export function useAdjustInventory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      stockLocationId,
      quantity,
      type,
      notes,
    }: {
      itemId: string;
      stockLocationId: string;
      quantity: number;
      type: "add" | "remove" | "set";
      notes?: string;
    }) =>
      api.post(`/inventory/items/${itemId}/adjust`, {
        stockLocationId,
        quantity,
        type,
        notes,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Stock adjusted");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to adjust stock"));
    },
  });
}

export function useTransferInventory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      fromLocationId,
      toLocationId,
      quantity,
      notes,
    }: {
      itemId: string;
      fromLocationId: string;
      toLocationId: string;
      quantity: number;
      notes?: string;
    }) =>
      api.post(`/inventory/items/${itemId}/transfer`, {
        fromLocationId,
        toLocationId,
        quantity,
        notes,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Stock transferred");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to transfer stock"));
    },
  });
}

export function useInventoryTransactions(itemId: string) {
  return useQuery({
    queryKey: ["inventory", "transactions", itemId],
    queryFn: async () => {
      const res = await api.get<ApiResponse<InventoryTransaction[]>>(
        `/inventory/items/${itemId}/transactions`,
      );
      return res.data;
    },
    enabled: !!itemId,
  });
}

// ─── Job parts consumption ───────────────────────────────────────────────────────

export function useJobParts(jobId: string) {
  return useQuery({
    queryKey: ["inventory", "job-parts", jobId],
    queryFn: async () => {
      const res = await api.get<ApiResponse<JobPart[]>>(
        `/inventory/jobs/${jobId}/parts`,
      );
      return res.data;
    },
    enabled: !!jobId,
  });
}

export function useIssueToJob() {
  const qc = useQueryClient();
  return useMutation({
    // Keyed to the offline default so a part logged with no signal replays
    // after an app reload (see lib/offlineMutations.ts).
    mutationKey: OFFLINE_MK.issueToJob,
    mutationFn: (payload: {
      jobId: string;
      inventoryItemId: string;
      stockLocationId: string;
      quantity: number;
      notes?: string;
    }) => api.post("/inventory/issue", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Part issued to job");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to issue part"));
    },
  });
}

export function useReverseTransaction() {
  const qc = useQueryClient();
  return useMutation({
    // Keyed to the offline default so removing a part with no signal replays
    // after an app reload (see lib/offlineMutations.ts).
    mutationKey: OFFLINE_MK.reverseTransaction,
    mutationFn: ({ id, reason }: { id: string; reason?: string }) =>
      api.post(`/inventory/transactions/${id}/reverse`, { reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Movement reversed");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to reverse movement"));
    },
  });
}

// ─── Cycle count ───────────────────────────────────────────────────────────────────

export interface CycleCountResult {
  counted: number;
  variances: number;
  results: {
    inventoryItemId: string;
    expected: number;
    counted: number;
    variance: number;
  }[];
}

export function useCycleCount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: {
      stockLocationId: string;
      counts: { inventoryItemId: string; countedQuantity: number }[];
      notes?: string;
    }) => {
      const res = await api.post<ApiResponse<CycleCountResult>>(
        "/inventory/cycle-count",
        payload,
      );
      return res.data;
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success(
        `Count applied: ${String(data.counted)} item(s), ${String(data.variances)} variance(s)`,
      );
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to apply count"));
    },
  });
}

// ─── Per-vendor catalog pricing ───────────────────────────────────────────────

export function useAddItemVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      ...payload
    }: {
      itemId: string;
      vendorId: string;
      unitCost: number;
      vendorSku?: string;
      leadTimeDays?: number;
      isPrimary?: boolean;
    }) => api.post(`/inventory/items/${itemId}/vendors`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Vendor price added");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to add vendor price"));
    },
  });
}

export function useRemoveItemVendor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, linkId }: { itemId: string; linkId: string }) =>
      api.delete(`/inventory/items/${itemId}/vendors/${linkId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Vendor price removed");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to remove vendor price"));
    },
  });
}
