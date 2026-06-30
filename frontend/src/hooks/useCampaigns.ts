import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse, Campaign } from "../types";
import toast from "react-hot-toast";

export function useCampaigns() {
  return useQuery({
    queryKey: ["campaigns"],
    queryFn: () => api.get<ApiResponse<Campaign[]>>("/campaigns"),
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
