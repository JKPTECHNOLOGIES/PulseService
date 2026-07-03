import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type {
  ApiResponse,
  InventoryItem,
  InventoryTransaction,
  StockLocation,
} from "../types";
import toast from "react-hot-toast";

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
    supplierId?: string;
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
