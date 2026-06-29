import { useQuery } from "@tanstack/react-query";
import api from "../lib/api";
import type { ApiResponse, Technician, PaginatedResponse } from "../types";

export function useTechnicians() {
  return useQuery({
    queryKey: ["technicians"],
    queryFn: () =>
      api.get<PaginatedResponse<Technician>>("/technicians", {
        params: { limit: 100 },
      }),
  });
}

export function useTechnician(id: string) {
  return useQuery({
    queryKey: ["technician", id],
    queryFn: async () => {
      const res = await api.get<ApiResponse<Technician>>(`/technicians/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}
