import { Fragment, useMemo, useState } from "react";
import { Combobox, Transition } from "@headlessui/react";
import {
  CheckIcon,
  ChevronUpDownIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import type { Job } from "../../types";

function jobLabel(j: Job): string {
  return `#${j.jobNumber} - ${j.summary}`;
}

interface JobComboboxProps {
  /** Candidate jobs to search/select from -- callers keep loading these the
   * same way they already do (e.g. `useJobs({ limit: 100 })`); this component
   * only adds type-to-filter on top of that list. */
  jobs: Job[];
  value: string;
  onChange: (jobId: string) => void;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Shows a clear (x) button once a job is selected, for optional
   * relationships where "no job" is a valid, reachable state. */
  clearable?: boolean;
}

/** Type-to-search work order picker, matching CustomerCombobox's UX so a long
 * job list doesn't force scrolling through a giant native `<select>`. */
export default function JobCombobox({
  jobs,
  value,
  onChange,
  error,
  disabled,
  placeholder = "Search work orders...",
  clearable = false,
}: JobComboboxProps) {
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => jobs.find((j) => j.id === value) ?? null,
    [jobs, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) => jobLabel(j).toLowerCase().includes(q));
  }, [jobs, query]);

  return (
    <Combobox
      value={selected}
      onChange={(j: Job | null) => {
        onChange(j ? j.id : "");
      }}
      disabled={disabled}
    >
      <div className="relative">
        <div className="relative">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Combobox.Input
            className={clsx(
              "w-full pl-9 pr-9 py-2.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white disabled:bg-gray-50 disabled:text-gray-400",
              error ? "border-red-300" : "border-gray-300",
            )}
            placeholder={placeholder}
            displayValue={(j: Job | null) => (j ? jobLabel(j) : "")}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          {clearable && selected && !disabled && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => {
                onChange("");
              }}
              className="absolute right-8 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Clear selection"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          )}
          <Combobox.Button className="absolute right-2 top-1/2 -translate-y-1/2">
            <ChevronUpDownIcon className="h-4 w-4 text-gray-400" />
          </Combobox.Button>
        </div>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
          afterLeave={() => {
            setQuery("");
          }}
        >
          <Combobox.Options className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg focus:outline-none">
            {filtered.length === 0 ? (
              <div className="px-3.5 py-2 text-gray-400">
                No work orders match "{query}".
              </div>
            ) : (
              filtered.map((j) => (
                <Combobox.Option
                  key={j.id}
                  value={j}
                  className={({ active }) =>
                    clsx(
                      "cursor-pointer select-none px-3.5 py-2",
                      active ? "bg-primary-50 text-primary-900" : "text-gray-900",
                    )
                  }
                >
                  {({ selected: isSelected }) => (
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={clsx(
                          "truncate",
                          isSelected && "font-medium",
                        )}
                      >
                        {jobLabel(j)}
                      </span>
                      {isSelected && (
                        <CheckIcon className="h-4 w-4 text-primary-600 shrink-0" />
                      )}
                    </div>
                  )}
                </Combobox.Option>
              ))
            )}
          </Combobox.Options>
        </Transition>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </Combobox>
  );
}
