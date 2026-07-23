import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import toast from "../lib/toast";
import type { ApiResponse, PaginatedResponse, TimelineItem } from "../types";

type TimelineResponse = PaginatedResponse<TimelineItem> & {
  pinned: TimelineItem[];
};

/** The merged Work Order + Invoice + Quote timeline for one customer. */
export function useTimeline(customerId: string, page = 1, limit = 20) {
  return useQuery({
    queryKey: ["timeline", customerId, page],
    queryFn: () =>
      api.get<TimelineResponse>("/timeline", {
        params: { customerId, page, limit },
      }),
    enabled: !!customerId,
  });
}

export function useCreateNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerId, body }: { customerId: string; body: string }) =>
      api.post<ApiResponse<TimelineItem>>("/notes", { customerId, body }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["timeline", vars.customerId] });
      toast.success("Note added");
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to add note"));
    },
  });
}

export function useSetNotePinned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      pinned,
    }: {
      id: string;
      pinned: boolean;
      customerId: string;
    }) => api.patch<ApiResponse<TimelineItem>>(`/notes/${id}/pin`, { pinned }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ["timeline", vars.customerId] });
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update note"));
    },
  });
}
