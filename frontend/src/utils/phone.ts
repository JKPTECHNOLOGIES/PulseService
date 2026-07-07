import toast from "react-hot-toast";
import { formatPhone } from "./formatters";

export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
}

// Whether the current device can actually place a call from a `tel:` link.
// Phones always can; macOS can via Continuity/FaceTime. Plain desktop browsers
// generally can't (no dialer app), so we fall back to copying the number.
export function canDial(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    isApplePlatform()
  );
}

/**
 * Open the device dialer for `phone`, or (on desktops with no dialer) copy the
 * number to the clipboard and confirm with a toast. Fixes the "Call does
 * nothing" case where a bare tel: link is silently ignored by the browser.
 */
export async function dialOrCopyPhone(phone: string): Promise<void> {
  const dial = phone.replace(/[^\d+]/g, "");
  if (!dial) return;
  if (canDial()) {
    window.location.href = `tel:${dial}`;
    return;
  }
  const pretty = formatPhone(phone);
  try {
    await navigator.clipboard.writeText(pretty);
    toast.success(`Phone number copied: ${pretty}`);
  } catch {
    toast(pretty, { icon: "\uD83D\uDCDE" });
  }
}
