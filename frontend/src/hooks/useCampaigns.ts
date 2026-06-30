import { useQuery } from "@tanstack/react-query";
import api from "../lib/api";
import type { Campaign, PaginatedResponse } from "../types";

interface CampaignsParams {
  page?: number;
  limit?: number;
}

export function useCampaigns(params: CampaignsParams = { limit: 50 }) {
  return useQuery({
    queryKey: ["campaigns", params],
    queryFn: () => api.get<PaginatedResponse<Campaign>>("/campaigns", { params }),
  });
}
