import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { MOD_KEY, isTypingTarget } from "../../lib/keys";

// Top-level sections whose primary "create" action lives at /<section>/new.
const NEW_ROUTES: Record<string, string> = {
  "/customers": "/customers/new",
  "/jobs": "/jobs/new",
  "/estimates": "/estimates/new",
  "/invoices": "/invoices/new",
};

function sectionOf(pathname: string): string {
  return "/" + (pathname.split("/")[1] ?? "");
}

/**
 * Global power-user shortcuts that live outside the command palette:
 *   n  → new record on a list page      ?  → toggle this help overlay
 * (⌘/Ctrl K and / open the palette; handled in CommandPalette.)
 */
export default function KeyboardShortcuts() {
  const navigate = useNavigate();
  const location = useLocation();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setHelpOpen(false);
        return;
      }
      // Leave modifier combos and normal typing alone.
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) {
        return;
      }
      if (e.key === "n") {
        const dest = NEW_ROUTES[sectionOf(location.pathname)];
        if (typeof dest === "string") {
          e.preventDefault();
          navigate(dest);
        }
      } else if (e.key === "?") {
        e.preventDefault();
        setHelpOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [location.pathname, navigate]);

  if (!helpOpen) return null;

  const rows: { keys: string[]; label: string }[] = [
    { keys: [MOD_KEY, "K"], label: "Open search palette" },
    { keys: ["/"], label: "Open search palette" },
    { keys: ["n"], label: "New record (on a list page)" },
    { keys: ["?"], label: "Toggle this help" },
    { keys: ["Esc"], label: "Close dialogs" },
  ];

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/30 flex items-center justify-center px-4"
      onClick={() => {
        setHelpOpen(false);
      }}
    >
      <div
        className="w-full max-w-sm bg-white rounded-xl shadow-2xl ring-1 ring-black/5 overflow-hidden"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-900">
            Keyboard shortcuts
          </p>
        </div>
        <ul className="p-2">
          {rows.map((r) => (
            <li
              key={r.label + r.keys.join("+")}
              className="flex items-center justify-between px-2 py-2"
            >
              <span className="text-sm text-gray-700">{r.label}</span>
              <span className="flex items-center gap-1">
                {r.keys.map((k) => (
                  <kbd
                    key={k}
                    className="px-1.5 py-0.5 text-[11px] font-medium text-gray-500 bg-gray-100 border border-gray-200 rounded"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
