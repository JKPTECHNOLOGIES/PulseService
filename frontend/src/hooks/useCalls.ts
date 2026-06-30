import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse, Call, PaginatedResponse } from "../types";
import toast from "react-hot-toast";

interface CallsParams {
  page?: number;
  limit?: number;
  direction?: string;
  status?: string;
  customerId?: string;
}

export function useCalls(params: CallsParams = {}) {
  return useQuery({
    queryKey: ["calls", params],
    queryFn: () => api.get<PaginatedResponse<Call>>("/calls", { params }),
  });
}

export function useLogCall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<Call>) =>
      api.post<ApiResponse<Call>>("/calls", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["calls"] });
      toast.success("Call logged");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to log call"));
    },
  });
}
