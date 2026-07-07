import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { ApiResponse, CustomerMessage, PaginatedResponse } from "../types";
import toast from "../lib/toast";

interface MessagesParams {
  page?: number;
  limit?: number;
  customerId?: string;
  direction?: string;
  channel?: string;
  search?: string;
}

export function useMessages(params: MessagesParams = {}) {
  return useQuery({
    queryKey: ["messages", params],
    queryFn: () => api.get<PaginatedResponse<CustomerMessage>>("/messages", { params }),
  });
}

export function useLogMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: Partial<CustomerMessage>) =>
      api.post<ApiResponse<CustomerMessage>>("/messages", payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["messages"] });
      toast.success("Message logged");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to log message"));
    },
  });
}

export function useDeleteMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/messages/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["messages"] });
      toast.success("Message removed");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to remove message"));
    },
  });
}
