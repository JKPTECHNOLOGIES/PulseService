import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import api from "../../lib/api";
import type { ApiResponse } from "../../types";

interface SearchResult {
  type: string;
  id: string;
  label: string;
  sublabel?: string;
  url: string;
}

/**
 * Hidden "jump to anything" palette. There is intentionally NO on-screen
 * affordance for it — it only opens via Ctrl/Cmd + K for those who know.
 */
export default function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(query.trim());
    }, 200);
    return () => {
      clearTimeout(t);
    };
  }, [query]);

  useEffect(() => {
    setActive(0);
  }, [debounced]);

  const { data } = useQuery({
    queryKey: ["globalSearch", debounced],
    queryFn: async () =>
      (
        await api.get<ApiResponse<{ results: SearchResult[] }>>("/search", {
          params: { q: debounced },
        })
      ).data,
    enabled: open && debounced.length >= 2,
  });
  const results = data?.results ?? [];

  const close = () => {
    setOpen(false);
    setQuery("");
    setDebounced("");
    setActive(0);
  };

  const go = (r?: SearchResult) => {
    if (!r) return;
    close();
    navigate(r.url);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/30 flex items-start justify-center pt-24 px-4"
      onClick={close}
    >
      <div
        className="w-full max-w-xl bg-white rounded-xl shadow-2xl ring-1 ring-black/5 overflow-hidden"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <div className="px-4 pt-3">
          <p className="text-xs font-medium text-primary-600">
            In a rush, huh? 🏃 Jump anywhere.
          </p>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(results[active]);
            }
          }}
          placeholder="Search customers, jobs, invoices, estimates…"
          className="w-full px-4 py-3 text-sm border-b border-gray-100 focus:outline-none"
        />
        <div className="max-h-80 overflow-y-auto">
          {debounced.length < 2 ? (
            <p className="px-4 py-6 text-center text-xs text-gray-400">
              Type at least 2 characters…
            </p>
          ) : results.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-gray-400">
              Nothing found for “{debounced}”.
            </p>
          ) : (
            results.map((r, i) => (
              <button
                key={`${r.type}-${r.id}`}
                onMouseEnter={() => {
                  setActive(i);
                }}
                onClick={() => {
                  go(r);
                }}
                className={
                  "w-full text-left px-4 py-2.5 flex items-center gap-3 " +
                  (i === active ? "bg-primary-50" : "hover:bg-gray-50")
                }
              >
                <span className="text-[10px] font-semibold uppercase text-gray-400 w-20 shrink-0">
                  {r.type}
                </span>
                <span className="text-sm font-medium text-gray-900 truncate">
                  {r.label}
                </span>
                {r.sublabel ? (
                  <span className="text-xs text-gray-400 truncate">
                    {r.sublabel}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
