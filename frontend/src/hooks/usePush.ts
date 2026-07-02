import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import api from "../lib/api";
import type { ApiResponse } from "../types";

// VAPID public keys are base64url; the PushManager wants a Uint8Array.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

const supported =
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  typeof window !== "undefined" &&
  "PushManager" in window &&
  "Notification" in window;

export function usePushNotifications() {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) return;
    void navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        setEnabled(!!sub);
      })
      .catch(() => undefined);
  }, []);

  const enable = useCallback(async () => {
    if (!supported) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.error("Notification permission was denied");
        return;
      }
      const res = await api.get<ApiResponse<{ key: string | null }>>(
        "/push/vapid-public-key",
      );
      if (!res.data.key) {
        toast.error("Push is not configured on the server");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(res.data.key),
      });
      const json = sub.toJSON();
      await api.post("/push/subscribe", {
        endpoint: json.endpoint,
        keys: json.keys,
      });
      setEnabled(true);
      toast.success("Notifications enabled");
    } catch {
      toast.error("Could not enable notifications");
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    if (!supported) return;
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.post("/push/unsubscribe", { endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setEnabled(false);
      toast.success("Notifications disabled");
    } catch {
      toast.error("Could not disable notifications");
    } finally {
      setBusy(false);
    }
  }, []);

  return { supported, enabled, busy, enable, disable };
}
