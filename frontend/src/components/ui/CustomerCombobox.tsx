import { Fragment, useMemo, useState } from "react";
import { Combobox, Transition } from "@headlessui/react";
import {
  CheckIcon,
  ChevronUpDownIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import type { Customer } from "../../types";

function customerLabel(c: Customer): string {
  const name = `${c.firstName} ${c.lastName}`.trim();
  return c.companyName ? `${name} (${c.companyName})` : name;
}

interface CustomerComboboxProps {
  /** Candidate customers to search/select from -- callers keep loading these
   * the same way they already do (e.g. `useCustomers({ limit: 200 })`); this
   * component only adds type-to-filter on top of that list. */
  customers: Customer[];
  value: string;
  onChange: (customerId: string) => void;
  error?: string;
  disabled?: boolean;
  placeholder?: string;
}

/** Type-to-search customer picker, matching the pricebook item search UX
 * (see `PricebookQuickAdd` in LineItemsTable.tsx) so long customer lists
 * don't force scrolling through a giant native `<select>`. */
export default function CustomerCombobox({
  customers,
  value,
  onChange,
  error,
  disabled,
  placeholder = "Search customers...",
}: CustomerComboboxProps) {
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => customers.find((c) => c.id === value) ?? null,
    [customers, value],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      customerLabel(c).toLowerCase().includes(q),
    );
  }, [customers, query]);

  return (
    <Combobox
      value={selected}
      onChange={(c: Customer | null) => {
        onChange(c ? c.id : "");
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
            displayValue={(c: Customer | null) => (c ? customerLabel(c) : "")}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
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
                No customers match "{query}".
              </div>
            ) : (
              filtered.map((c) => (
                <Combobox.Option
                  key={c.id}
                  value={c}
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
                        {customerLabel(c)}
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
