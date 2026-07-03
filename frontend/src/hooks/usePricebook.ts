import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse, PricebookCategory, PricebookItem } from "../types";
import toast from "react-hot-toast";

export function usePricebookCategories() {
  return useQuery({
    queryKey: ["pricebook", "categories"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<PricebookCategory[]>>(
        "/pricebook/categories",
      );
      return res.data;
    },
  });
}

export function usePricebookItems(
  params: { categoryId?: string; search?: string; customerId?: string } = {},
) {
  return useQuery({
    queryKey: ["pricebook", "items", params],
    queryFn: async () => {
      const res = await api.get<ApiResponse<PricebookItem[]>>(
        "/pricebook/items",
        { params },
      );
      return res.data;
    },
  });
}

export function useCreatePricebookItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<PricebookItem>) =>
      api.post<ApiResponse<PricebookItem>>("/pricebook/items", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["pricebook"] });
      toast.success("Item created successfully");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to create item"));
    },
  });
}

export function useUpdatePricebookItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<PricebookItem> & { id: string }) =>
      api.put<ApiResponse<PricebookItem>>(`/pricebook/items/${id}`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["pricebook"] });
      toast.success("Item updated successfully");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update item"));
    },
  });
}

export function useCreatePricebookCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<PricebookCategory>) =>
      api.post<ApiResponse<PricebookCategory>>(
        "/pricebook/categories",
        payload,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["pricebook", "categories"] });
      toast.success("Category created");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to create category"));
    },
  });
}
