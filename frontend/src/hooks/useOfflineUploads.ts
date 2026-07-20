import { useCallback, useEffect, useState } from "react";
import {
  getPendingUploads,
  removePendingUpload,
  subscribeToUploadQueueChanges,
  type PendingUpload,
} from "../lib/offlineUploads";
import type { AttachmentEntityType } from "../types";

/**
 * Reactively reads the queued (not-yet-uploaded) photos/signatures for one
 * entity, or every queued upload when no entity is given (for a global
 * count). Re-reads whenever the queue changes -- see
 * lib/offlineUploads.ts's subscribeToUploadQueueChanges.
 */
export function usePendingUploads(
  entityType?: AttachmentEntityType,
  entityId?: string,
): PendingUpload[] {
  const [uploads, setUploads] = useState<PendingUpload[]>([]);

  const refresh = useCallback(() => {
    void getPendingUploads().then((all) => {
      setUploads(
        entityType
          ? all.filter(
              (u) => u.entityType === entityType && u.entityId === entityId,
            )
          : all,
      );
    });
  }, [entityType, entityId]);

  useEffect(() => {
    refresh();
    return subscribeToUploadQueueChanges(refresh);
  }, [refresh]);

  return uploads;
}

export { removePendingUpload };
