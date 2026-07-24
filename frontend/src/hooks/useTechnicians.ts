import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import toast from "../lib/toast";
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

// Admin-only (technicians.payRates): set a technician's going hourly pay
// rate. Pass `null` to clear a previously-set rate.
export function useUpdateTechnicianPayRate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payRate }: { id: string; payRate: number | null }) =>
      api.put<ApiResponse<Technician>>(`/technicians/${id}/pay-rate`, {
        payRate,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["technicians"] });
      toast.success("Pay rate updated");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update pay rate"));
    },
  });
}
