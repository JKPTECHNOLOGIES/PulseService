/* eslint-disable react-refresh/only-export-components -- utility module, not a component file */
import baseToast from "react-hot-toast";
import { XCircleIcon } from "@heroicons/react/24/outline";
import { takeRecentApiError } from "./apiErrorStore";

// Re-export so callers can keep a single import from this module.
export { Toaster } from "react-hot-toast";

// Assemble a copy-pasteable report: the shown message plus any request
// diagnostics recorded by the API layer, the page, and the time.
function buildCopyText(message: string): string {
  const lines = [
    "PulseService error report",
    `Message: ${message}`,
    `When: ${new Date().toLocaleString()}`,
    `Page: ${window.location.pathname}`,
  ];
  const info = takeRecentApiError();
  if (info) {
    const req = `${info.method ?? ""} ${info.url ?? ""}`.trim();
    if (req) lines.push(`Request: ${req}`);
    if (typeof info.status === "number")
      lines.push(`Status: ${String(info.status)}`);
  }
  return lines.join("\n");
}

// A clickable error toast: shows a clear message and copies the full report to
// the clipboard on click, so users can paste it straight into a bug report.
function errorToast(
  message: unknown,
  opts?: Parameters<typeof baseToast>[1],
): string {
  const text = typeof message === "string" ? message : "Something went wrong";
  const copyText = buildCopyText(text);
  return baseToast.custom(
    (t) => (
      <div
        role="button"
        tabIndex={0}
        title="Click to copy the error details"
        onClick={() => {
          void navigator.clipboard.writeText(copyText).then(
            () => {
              baseToast.success("Error copied — paste it in your message", {
                duration: 2000,
              });
            },
            () => {
              /* clipboard blocked (e.g. insecure context) — ignore */
            },
          );
          baseToast.dismiss(t.id);
        }}
        className="flex w-full max-w-sm cursor-pointer items-start gap-2.5 rounded-lg bg-white px-4 py-3 shadow-lg ring-1 ring-black/5"
      >
        <XCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-900 break-words">{text}</p>
          <p className="mt-0.5 text-[11px] text-gray-400">
            Tap to copy details
          </p>
        </div>
      </div>
    ),
    { duration: 6000, ...opts },
  );
}

// Wrap react-hot-toast: same callable + methods, but error toasts are the
// clickable copy-to-clipboard variant above.
const toast = Object.assign(
  (
    msg: Parameters<typeof baseToast>[0],
    opts?: Parameters<typeof baseToast>[1],
  ) => baseToast(msg, opts),
  baseToast,
  { error: errorToast },
);

export default toast;
