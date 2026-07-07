import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse, Campaign } from "../types";
import toast from "../lib/toast";

interface CampaignsParams {
  status?: string;
  /** "true" = only archived, "all" = both, omitted/false = active only. */
  archived?: string;
}

export function useCampaigns(params: CampaignsParams = {}) {
  return useQuery({
    queryKey: ["campaigns", params],
    queryFn: () => api.get<ApiResponse<Campaign[]>>("/campaigns", { params }),
    select: (res) => res.data,
  });
}

export function useCreateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Campaign>) =>
      api.post<ApiResponse<Campaign>>("/campaigns", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success("Campaign created");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to create campaign"));
    },
  });
}

export function useUpdateCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...payload }: Partial<Campaign> & { id: string }) =>
      api.put<ApiResponse<Campaign>>(`/campaigns/${id}`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success("Campaign updated");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update campaign"));
    },
  });
}

export function useDeleteCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/campaigns/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success("Campaign deleted");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to delete campaign"));
    },
  });
}

export function useArchiveCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<ApiResponse<Campaign>>(`/campaigns/${id}/archive`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success("Campaign archived");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to archive campaign"));
    },
  });
}

export function useUnarchiveCampaign() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<ApiResponse<Campaign>>(`/campaigns/${id}/unarchive`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["campaigns"] });
      toast.success("Campaign restored");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to restore campaign"));
    },
  });
}
