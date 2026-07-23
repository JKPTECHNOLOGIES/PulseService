import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import toast from "../lib/toast";
import type { ApiResponse, CompanySettings } from "../types";

export function useCompanySettings() {
  return useQuery({
    queryKey: ["settings", "company"],
    queryFn: async () => {
      const res = await api.get<ApiResponse<CompanySettings>>("/settings");
      return res.data;
    },
  });
}

export function useUpdateCompanySettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<CompanySettings>) =>
      api.put("/settings", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["settings"] });
      toast.success("Settings saved");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to save settings"));
    },
  });
}
