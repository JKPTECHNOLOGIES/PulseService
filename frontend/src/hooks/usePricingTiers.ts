import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse, PricingTier, PricingTierOverride } from "../types";
import toast from "../lib/toast";

export function usePricingTiers() {
  return useQuery({
    queryKey: ["pricing-tiers"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<PricingTier[]>>("/pricing-tiers");
      return res.data;
    },
  });
}

export function usePricingTier(id: string) {
  return useQuery({
    queryKey: ["pricing-tiers", "detail", id],
    queryFn: async () => {
      const res = await api.get<ApiResponse<PricingTier>>(`/pricing-tiers/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useSavePricingTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<PricingTier> & { id?: string }) =>
      id
        ? api.put<ApiResponse<PricingTier>>(`/pricing-tiers/${id}`, payload)
        : api.post<ApiResponse<PricingTier>>("/pricing-tiers", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["pricing-tiers"] });
      toast.success("Pricing tier saved");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to save pricing tier"));
    },
  });
}

export function useDeletePricingTier() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/pricing-tiers/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["pricing-tiers"] });
      toast.success("Pricing tier deactivated");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to deactivate pricing tier"));
    },
  });
}

export function useAddPricingTierOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      tierId,
      ...payload
    }: {
      tierId: string;
      pricebookItemId: string;
      overrideType: string;
      overrideValue: number;
    }) =>
      api.post<ApiResponse<PricingTierOverride>>(
        `/pricing-tiers/${tierId}/overrides`,
        payload,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["pricing-tiers"] });
      toast.success("Override added");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to add override"));
    },
  });
}

export function useRemovePricingTierOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ tierId, overrideId }: { tierId: string; overrideId: string }) =>
      api.delete(`/pricing-tiers/${tierId}/overrides/${overrideId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["pricing-tiers"] });
      toast.success("Override removed");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to remove override"));
    },
  });
}
