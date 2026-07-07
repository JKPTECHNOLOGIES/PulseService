import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type {
  ApiResponse,
  PaginatedResponse,
  PurchaseOrder,
  ReorderSuggestionGroup,
} from "../types";
import toast from "react-hot-toast";

export interface POLineInput {
  inventoryItemId?: string;
  lineType?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  notes?: string;
}

export interface ReceiveLineInput {
  lineId: string;
  quantityReceived: number;
  stockLocationId?: string;
  unitCost?: number;
  serialNumbers?: string[];
  lotNumber?: string;
  documentNumber?: string;
  notes?: string;
}

export function usePurchaseOrders(
  params: {
    page?: number;
    limit?: number;
    status?: string;
    supplierId?: string;
    jobId?: string;
    search?: string;
  } = {},
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ["purchasing", "list", params],
    enabled: options.enabled,
    queryFn: async () => {
      const res = await api.get<PaginatedResponse<PurchaseOrder>>(
        "/purchasing/purchase-orders",
        { params },
      );
      return res;
    },
  });
}

export function useReorderSuggestions(enabled = true) {
  return useQuery({
    queryKey: ["purchasing", "reorder-suggestions"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<ReorderSuggestionGroup[]>>(
        "/purchasing/reorder-suggestions",
      );
      return res.data;
    },
    enabled,
  });
}

export function usePurchaseOrder(id: string) {
  return useQuery({
    queryKey: ["purchasing", "detail", id],
    queryFn: async () => {
      const res = await api.get<ApiResponse<PurchaseOrder>>(
        `/purchasing/purchase-orders/${id}`,
      );
      return res.data;
    },
    enabled: !!id,
  });
}

export function useCreatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      supplierId: string;
      shipToLocationId?: string;
      jobId?: string;
      customerId?: string;
      expectedDate?: string;
      notes?: string;
      taxAmount?: number;
      shippingCost?: number;
      lines: POLineInput[];
    }) =>
      api.post<ApiResponse<PurchaseOrder>>(
        "/purchasing/purchase-orders",
        payload,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["purchasing"] });
      toast.success("Purchase order created");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to create purchase order"));
    },
  });
}

export function useUpdatePurchaseOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...payload
    }: Record<string, unknown> & { id: string }) =>
      api.put<ApiResponse<PurchaseOrder>>(
        `/purchasing/purchase-orders/${id}`,
        payload,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["purchasing"] });
      toast.success("Purchase order updated");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update purchase order"));
    },
  });
}

export function useSetPOStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      status,
      cancelledReason,
    }: {
      id: string;
      status: string;
      cancelledReason?: string;
    }) =>
      api.put<ApiResponse<PurchaseOrder>>(
        `/purchasing/purchase-orders/${id}/status`,
        { status, cancelledReason },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["purchasing"] });
      toast.success("Status updated");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update status"));
    },
  });
}

export function useReceiveItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, items }: { id: string; items: ReceiveLineInput[] }) =>
      api.post<ApiResponse<PurchaseOrder>>(
        `/purchasing/purchase-orders/${id}/receive-items`,
        { items },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["purchasing"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Goods received");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to receive goods"));
    },
  });
}

export function useReverseReceipt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      receiptId,
      reason,
    }: {
      id: string;
      receiptId: string;
      reason?: string;
    }) =>
      api.post(
        `/purchasing/purchase-orders/${id}/receipts/${receiptId}/reverse`,
        { reason },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["purchasing"] });
      void qc.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Receipt reversed");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to reverse receipt"));
    },
  });
}
