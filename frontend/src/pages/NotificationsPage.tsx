import { useNavigate } from "react-router-dom";
import clsx from "clsx";
import {
  useNotifications,
  useMarkNotificationsRead,
} from "../hooks/useNotifications";
import { useLookup } from "../hooks/useMetadata";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import { PageSpinner } from "../components/ui/Spinner";
import { formatDateTime } from "../utils/formatters";

const TYPE_DOT: Record<string, string> = {
  info: "bg-blue-500",
  success: "bg-green-500",
  warning: "bg-orange-500",
  error: "bg-red-500",
};

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const { getLabel: getTypeLabel } = useLookup("notificationType");

  const notifications = data?.data ?? [];
  const unreadCount = data?.unreadCount ?? 0;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {unreadCount > 0
            ? `${String(unreadCount)} unread`
            : "No unread notifications"}
        </p>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              markRead.mutate({ all: true });
            }}
          >
            Mark all read
          </Button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {isLoading ? (
          <PageSpinner />
        ) : notifications.length === 0 ? (
          <EmptyState
            title="You're all caught up"
            description="New notifications about jobs, invoices, and estimates will appear here."
          />
        ) : (
          <ul className="divide-y divide-gray-50">
            {notifications.map((n) => {
              const clickable = Boolean(n.link);
              return (
                <li
                  key={n.id}
                  onClick={() => {
                    if (!n.isRead) markRead.mutate({ id: n.id });
                    if (n.link) navigate(n.link);
                  }}
                  className={clsx(
                    "flex gap-3 px-5 py-4 transition-colors",
                    clickable && "cursor-pointer hover:bg-gray-50",
                    !n.isRead && "bg-primary-50/40",
                  )}
                >
                  <span
                    className={clsx(
                      "mt-1.5 h-2.5 w-2.5 rounded-full shrink-0",
                      n.isRead ? "bg-gray-200" : (TYPE_DOT[n.type] ?? "bg-primary-500"),
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <p
                        className={clsx(
                          "text-sm",
                          n.isRead
                            ? "text-gray-700 font-medium"
                            : "text-gray-900 font-semibold",
                        )}
                      >
                        {n.title}
                      </p>
                      <span className="text-xs text-gray-400 shrink-0">
                        {formatDateTime(n.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">{n.message}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-[11px] uppercase tracking-wide text-gray-400">
                        {getTypeLabel(n.type)}
                      </span>
                      {!n.isRead && (
                        <span className="text-[11px] font-medium text-primary-600">
                          • New
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
