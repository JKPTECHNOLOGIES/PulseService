import type { QueryClient } from "@tanstack/react-query";
import api from "./api";
import { getErrorMessage } from "./errors";
import toast from "./toast";
import type { ApiResponse, Attachment, AttachmentEntityType } from "../types";

/**
 * Offline queue for photo/signature uploads.
 *
 * These can't go through the JSON mutation queue in `offlineMutations.ts`:
 * that queue persists mutation *variables* to localStorage (via the
 * TanStack Query persister), and a `File`/`Blob` isn't JSON-serializable —
 * even base64-encoding it would blow past localStorage's ~5-10MB total quota
 * after a couple of photos. IndexedDB stores Blobs natively and gives much
 * more room, so queued uploads live here instead, in their own store, and are
 * drained by `drainUploadQueue` whenever connectivity returns.
 */

const DB_NAME = "pulse-offline-uploads";
const DB_VERSION = 1;
const STORE = "uploads";
const CHANGE_EVENT = "pulse-offline-uploads-changed";

export interface PendingUpload {
  id: string;
  entityType: AttachmentEntityType;
  entityId: string;
  file: File;
  caption?: string;
  createdAt: number;
  status: "pending" | "error";
  error?: string;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(new Error("Failed to open offline uploads database"));
    };
  });
}

// Components can't subscribe to IndexedDB directly, so a plain window event
// stands in for "the queue changed" -- see hooks/useOfflineUploads.ts.
function notifyChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeToUploadQueueChanges(cb: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, cb);
  return () => {
    window.removeEventListener(CHANGE_EVENT, cb);
  };
}

export async function queueUpload(entry: {
  entityType: AttachmentEntityType;
  entityId: string;
  file: File;
  caption?: string;
}): Promise<PendingUpload> {
  const record: PendingUpload = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    status: "pending",
  };
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add(record);
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(new Error("Failed to queue upload"));
    };
  });
  notifyChange();
  return record;
}

export async function getPendingUploads(): Promise<PendingUpload[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      resolve(req.result as PendingUpload[]);
    };
    req.onerror = () => {
      reject(new Error("Failed to read queued uploads"));
    };
  });
}

export async function removePendingUpload(id: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(new Error("Failed to remove queued upload"));
    };
  });
  notifyChange();
}

async function markUploadFailed(id: string, error: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result as PendingUpload | undefined;
      if (record) store.put({ ...record, status: "error", error });
    };
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(new Error("Failed to update queued upload"));
    };
  });
  notifyChange();
}

/**
 * Resets a failed upload back to "pending" so the next drain retries it.
 * Used by the offline indicator's manual "Retry" action.
 */
export async function retryPendingUpload(id: string): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result as PendingUpload | undefined;
      if (record)
        store.put({ ...record, status: "pending", error: undefined });
    };
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(new Error("Failed to retry upload"));
    };
  });
  notifyChange();
}

/**
 * Wipes every queued upload. Called on logout so one account's queued
 * photos/signatures never get uploaded under (or shown to) another account
 * on a shared device -- mirrors clearOfflineData() in lib/queryClient.ts.
 */
export async function clearPendingUploads(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => {
      resolve();
    };
    tx.onerror = () => {
      reject(new Error("Failed to clear queued uploads"));
    };
  });
  notifyChange();
}

let draining = false;

/**
 * Uploads every queued photo/signature to the server, in order. Called on app
 * start (if already online) and whenever connectivity returns (see
 * main.tsx). Safe to call concurrently -- a second call while one is already
 * in flight is a no-op.
 */
export async function drainUploadQueue(qc: QueryClient): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    const pending = (await getPendingUploads()).filter(
      (u) => u.status === "pending",
    );
    if (pending.length === 0) return;

    let synced = 0;
    let failed = 0;
    const touchedEntities = new Set<string>();

    for (const upload of pending) {
      try {
        const form = new FormData();
        form.append("file", upload.file);
        form.append("entityType", upload.entityType);
        form.append("entityId", upload.entityId);
        if (upload.caption) form.append("caption", upload.caption);
        await api.post<ApiResponse<Attachment>>("/attachments", form, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        await removePendingUpload(upload.id);
        touchedEntities.add(`${upload.entityType}:${upload.entityId}`);
        synced += 1;
      } catch (err) {
        await markUploadFailed(upload.id, getErrorMessage(err, "Upload failed"));
        failed += 1;
      }
    }

    for (const key of touchedEntities) {
      const [entityType, entityId] = key.split(":");
      void qc.invalidateQueries({
        queryKey: ["attachments", entityType, entityId],
      });
    }

    if (synced > 0) {
      toast.success(
        `${String(synced)} photo${synced === 1 ? "" : "s"} synced`,
      );
    }
    if (failed > 0) {
      toast.error(
        `${String(failed)} photo${failed === 1 ? "" : "s"} failed to sync — check the gallery`,
      );
    }
  } finally {
    draining = false;
  }
}
