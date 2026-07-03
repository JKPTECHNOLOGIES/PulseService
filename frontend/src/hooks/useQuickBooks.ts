import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type {
  ApiResponse,
  PaginatedResponse,
  QuickBooksSettings,
  QuickBooksSyncQueueItem,
  QuickBooksMappingRecord,
  QuickBooksItemMappingRecord,
} from "../types";
import toast from "react-hot-toast";

export function useQuickBooksSettings() {
  return useQuery({
    queryKey: ["quickbooks", "settings"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<QuickBooksSettings>>("/quickbooks/settings");
      return res.data;
    },
  });
}

export function useSaveQuickBooksSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<QuickBooksSettings> & { webConnectorPassword?: string }) =>
      api.put<ApiResponse<QuickBooksSettings>>("/quickbooks/settings", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["quickbooks", "settings"] });
      toast.success("QuickBooks settings saved");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to save settings"));
    },
  });
}

/** Downloads the .qwc connector file the user opens once in Web Connector. */
export async function downloadQuickBooksConnectorFile() {
  const xml = await api.get<string>("/quickbooks/connector-file");
  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "pulseservice.qwc";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function useQuickBooksQueue(params: { page?: number; limit?: number; status?: string } = {}) {
  return useQuery({
    queryKey: ["quickbooks", "queue", params],
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<QuickBooksSyncQueueItem>>(
        "/quickbooks/queue",
        { params },
      );
      return res;
    },
  });
}

export function useRetryQuickBooksJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/quickbooks/queue/${id}/retry`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["quickbooks", "queue"] });
      toast.success("Queued for retry");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to retry"));
    },
  });
}

export function useQuickBooksMappings() {
  return useQuery({
    queryKey: ["quickbooks", "mappings"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<QuickBooksMappingRecord[]>>("/quickbooks/mappings");
      return res.data;
    },
  });
}

export function useResyncQuickBooksCustomers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ApiResponse<{ queued: number }>>("/quickbooks/resync/customers"),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["quickbooks", "queue"] });
      toast.success(`Queued ${String(res.data.queued)} customer(s) to sync`);
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to queue resync"));
    },
  });
}

export function useQuickBooksItemMappings() {
  return useQuery({
    queryKey: ["quickbooks", "item-mappings"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<QuickBooksItemMappingRecord[]>>(
        "/quickbooks/item-mappings",
      );
      return res.data;
    },
  });
}

export function useSaveQuickBooksItemMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      lineItemType?: string;
      pricebookItemId?: string;
      quickbooksItemName: string;
    }) => api.post("/quickbooks/item-mappings", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["quickbooks", "item-mappings"] });
      toast.success("Mapping saved");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to save mapping"));
    },
  });
}

export function useDeleteQuickBooksItemMapping() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/quickbooks/item-mappings/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["quickbooks", "item-mappings"] });
      toast.success("Mapping removed");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to remove mapping"));
    },
  });
}
