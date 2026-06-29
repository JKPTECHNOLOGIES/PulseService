import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type {
  ApiResponse,
  InventoryItem,
  InventoryTransaction,
} from "../types";
import toast from "react-hot-toast";

export function useInventoryItems() {
  return useQuery({
    queryKey: ["inventory", "items"],
    queryFn: async () => {
      const res =
        await api.get<ApiResponse<InventoryItem[]>>("/inventory/items");
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

export function useAdjustInventory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      quantity,
      type,
      notes,
    }: {
      itemId: string;
      quantity: number;
      type: "add" | "remove" | "adjust";
      notes?: string;
    }) =>
      api.post<ApiResponse<InventoryItem>>(
        `/inventory/items/${itemId}/adjust`,
        {
          quantity,
          type,
          notes,
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Inventory adjusted successfully");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to adjust inventory"));
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
