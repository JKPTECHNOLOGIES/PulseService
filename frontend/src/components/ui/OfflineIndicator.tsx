import { useEffect, useState } from "react";
import { onlineManager, useMutationState } from "@tanstack/react-query";
import { CloudArrowUpIcon, SignalSlashIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";

/**
 * Small floating status pill. Appears only when the app is offline or there are
 * mutations waiting to sync, so the user always knows whether their changes have
 * reached the server.
 */
export default function OfflineIndicator() {
  const [online, setOnline] = useState(onlineManager.isOnline());

  useEffect(() => onlineManager.subscribe(setOnline), []);

  // Count mutations currently paused (queued) waiting for connectivity.
  const pausedCount = useMutationState({
    filters: { predicate: (m) => m.state.isPaused },
  }).length;

  if (online && pausedCount === 0) return null;

  return (
    <div
      className={clsx(
        // Sits above the mobile bottom tab bar; lower on desktop where there is none.
        "fixed bottom-20 md:bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium shadow-lg",
        online ? "bg-primary-600 text-white" : "bg-gray-800 text-white",
      )}
    >
      {online ? (
        <CloudArrowUpIcon className="h-4 w-4" />
      ) : (
        <SignalSlashIcon className="h-4 w-4" />
      )}
      {online
        ? `Syncing${pausedCount > 0 ? ` · ${String(pausedCount)} pending` : ""}`
        : `Offline${pausedCount > 0 ? ` · ${String(pausedCount)} pending sync` : ""}`}
    </div>
  );
}
