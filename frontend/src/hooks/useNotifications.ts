import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "../lib/api";
import { getErrorMessage } from "../lib/errors";
import type { Notification } from "../types";
import toast from "../lib/toast";

interface NotificationsResponse {
  success: boolean;
  data: Notification[];
  unreadCount: number;
}

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get<NotificationsResponse>("/notifications"),
    // Poll periodically so new notifications surface without a reload.
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id?: string; all?: boolean }) =>
      api.post("/notifications/mark-read", vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err, "Failed to update notification"));
    },
  });
}
