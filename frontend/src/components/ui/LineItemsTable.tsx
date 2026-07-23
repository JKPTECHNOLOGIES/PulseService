import { Fragment, useEffect, useState } from "react";
import { Combobox, Transition } from "@headlessui/react";
import {
  PlusIcon,
  TrashIcon,
  ChevronUpDownIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import { formatCurrency } from "../../utils/formatters";
import { useLookup } from "../../hooks/useMetadata";
import { usePricebookItems } from "../../hooks/usePricebook";
import type { PricebookItem } from "../../types";
import Button from "./Button";
import { NumberInput } from "./NumberInput";

export interface LineItem {
  id?: string;
  type: string;
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  total: number;
  /** Whether this line counts toward the total and appears on the customer
   * PDF/email. Defaults to true when omitted. Only rendered/editable when
   * the table is used with `showIncludeToggle`. */
  includeOnDocument?: boolean;
}

interface LineItemsTableProps {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  readonly?: boolean;
  /** When given, the pricebook quick-add picker shows that customer's
   * tier-adjusted price instead of the raw catalog price. */
  customerId?: string;
  /** Shows a per-line checkbox controlling whether the line is billed and
   * appears on the customer-facing PDF/email (invoices only - estimates
   * don't pass this). */
  showIncludeToggle?: boolean;
  /** In `readonly` mode, the include checkbox is just an indicator (disabled)
   * unless this is given — pass it to let the checkbox itself be toggled
   * in place (e.g. on the invoice detail/view page) without entering full
   * edit mode. Ignored outside `readonly` (the editable table always allows
   * toggling directly). */
  onToggleInclude?: (index: number) => void;
}

function isIncluded(item: LineItem): boolean {
  return item.includeOnDocument !== false;
}

export default function LineItemsTable({
  items,
  onChange,
  readonly = false,
  customerId,
  showIncludeToggle = false,
  onToggleInclude,
}: LineItemsTableProps) {
  const { options: lineItemTypes } = useLookup("lineItemType");
  const addItem = () => {
    onChange([
      ...items,
      {
        type: "service",
        name: "",
        quantity: 1,
        unitPrice: 0,
        total: 0,
        includeOnDocument: true,
      },
    ]);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const updateItem = (
    index: number,
    field: keyof LineItem,
    value: string | number,
  ) => {
    const updated = items.map((item, i) => {
      if (i !== index) return item;
      const next = { ...item, [field]: value };
      if (field === "quantity" || field === "unitPrice") {
        next.total = next.quantity * next.unitPrice;
      }
      return next;
    });
    onChange(updated);
  };

  const toggleInclude = (index: number) => {
    onChange(
      items.map((item, i) =>
        i === index ? { ...item, includeOnDocument: !isIncluded(item) } : item,
      ),
    );
  };

  const allIncluded = items.length > 0 && items.every(isIncluded);
  const toggleAllIncluded = () => {
    const next = !allIncluded;
    onChange(items.map((item) => ({ ...item, includeOnDocument: next })));
  };

  // Excluded lines stay on the invoice for record-keeping but don't count
  // toward the total - mirrors the backend's calculateTotals rule exactly.
  const subtotal = items.reduce(
    (sum, item) => sum + (isIncluded(item) ? item.total : 0),
    0,
  );

  if (readonly) {
    return (
      <div>
        {/* Mobile: stacked cards (the table overflows a phone width) */}
        <div className="md:hidden space-y-2">
          {items.map((item, i) => (
            <div
              key={i}
              className={clsx(
                "rounded-lg border border-gray-100 p-3",
                showIncludeToggle && !isIncluded(item) && "opacity-60",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <p className="font-medium text-gray-900">{item.name}</p>
                <p className="font-medium text-gray-900 shrink-0">
                  {formatCurrency(item.total)}
                </p>
              </div>
              {item.description && (
                <p className="text-gray-500 text-xs mt-0.5">
                  {item.description}
                </p>
              )}
              <p className="text-gray-500 text-xs mt-1">
                {item.quantity} × {formatCurrency(item.unitPrice)}
              </p>
              {showIncludeToggle && (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={isIncluded(item)}
                    disabled={!onToggleInclude}
                    onChange={
                      onToggleInclude
                        ? () => {
                            onToggleInclude(i);
                          }
                        : undefined
                    }
                    title={
                      isIncluded(item)
                        ? "Included on the invoice and customer PDF/email"
                        : "Kept for record only - not billed or shown to the customer"
                    }
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-[10px] uppercase font-semibold text-gray-400">
                    {isIncluded(item) ? "On invoice" : "Not on invoice"}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
        {/* Desktop: table */}
        <table className="hidden md:table w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              {showIncludeToggle && (
                <th className="text-left py-2 font-medium text-gray-600 w-10">
                  <span className="sr-only">Included on invoice</span>
                </th>
              )}
              <th className="text-left py-2 font-medium text-gray-600 w-1/2">
                Item
              </th>
              <th className="text-right py-2 font-medium text-gray-600">Qty</th>
              <th className="text-right py-2 font-medium text-gray-600">
                Unit Price
              </th>
              <th className="text-right py-2 font-medium text-gray-600">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr
                key={i}
                className={clsx(
                  "border-b border-gray-100",
                  showIncludeToggle && !isIncluded(item) && "opacity-60",
                )}
              >
                {showIncludeToggle && (
                  <td className="py-3">
                    <input
                      type="checkbox"
                      checked={isIncluded(item)}
                      disabled={!onToggleInclude}
                      onChange={
                        onToggleInclude
                          ? () => {
                              onToggleInclude(i);
                            }
                          : undefined
                      }
                      title={
                        isIncluded(item)
                          ? "Included on the invoice and customer PDF/email"
                          : "Kept for record only - not billed or shown to the customer"
                      }
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500 disabled:opacity-50"
                    />
                  </td>
                )}
                <td className="py-3">
                  <p className="font-medium text-gray-900">{item.name}</p>
                  {item.description && (
                    <p className="text-gray-500 text-xs mt-0.5">
                      {item.description}
                    </p>
                  )}
                  {showIncludeToggle && !isIncluded(item) && (
                    <span className="inline-block mt-0.5 text-[10px] uppercase font-semibold text-gray-400">
                      Not on invoice
                    </span>
                  )}
                </td>
                <td className="text-right py-3 text-gray-700">
                  {item.quantity}
                </td>
                <td className="text-right py-3 text-gray-700">
                  {formatCurrency(item.unitPrice)}
                </td>
                <td className="text-right py-3 font-medium text-gray-900">
                  {formatCurrency(item.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <PricebookQuickAdd
        customerId={customerId}
        onAdd={(item) => {
          onChange([...items, { ...item, includeOnDocument: true }]);
        }}
      />
      {/* Mobile: stacked editable cards (the 6-column table is unusable on a
          phone). Desktop keeps the table below. */}
      <div className="md:hidden space-y-3">
        {items.map((item, i) => (
          <div
            key={i}
            className={clsx(
              "rounded-lg border border-gray-200 p-3 space-y-2",
              showIncludeToggle && !isIncluded(item) && "opacity-60",
            )}
          >
            <div className="flex items-center gap-2">
              {showIncludeToggle && (
                <input
                  type="checkbox"
                  checked={isIncluded(item)}
                  onChange={() => {
                    toggleInclude(i);
                  }}
                  title="Include on the invoice and customer PDF/email"
                  className="h-5 w-5 shrink-0 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
              )}
              <select
                value={item.type}
                onChange={(e) => {
                  updateItem(i, "type", e.target.value);
                }}
                className="flex-1 text-sm border border-gray-300 rounded-md px-2 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white"
              >
                {lineItemTypes.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  removeItem(i);
                }}
                aria-label="Remove line item"
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] shrink-0 text-gray-400 hover:text-red-500 rounded-lg transition-colors"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
            <input
              type="text"
              value={item.name}
              onChange={(e) => {
                updateItem(i, "name", e.target.value);
              }}
              placeholder="Item name"
              className="w-full text-sm border border-gray-300 rounded-md px-2 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
            <input
              type="text"
              value={item.description ?? ""}
              onChange={(e) => {
                updateItem(i, "description", e.target.value);
              }}
              placeholder="Description (optional)"
              className="w-full text-sm border border-gray-200 rounded-md px-2 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500 text-gray-500"
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Qty</label>
                <NumberInput
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={item.quantity}
                  onChange={(n) => {
                    updateItem(i, "quantity", n ?? 0);
                  }}
                  className="w-full text-right text-sm border border-gray-300 rounded-md px-2 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">
                  Unit Price
                </label>
                <NumberInput
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={item.unitPrice}
                  onChange={(n) => {
                    updateItem(i, "unitPrice", n ?? 0);
                  }}
                  className="w-full text-right text-sm border border-gray-300 rounded-md px-2 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>
            </div>
            <div className="flex justify-between text-sm pt-1 border-t border-gray-100">
              <span className="text-gray-500">Total</span>
              <span className="font-medium text-gray-900">
                {formatCurrency(item.total)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <table className="hidden md:table w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            {showIncludeToggle && (
              <th className="py-2 w-8">
                <input
                  type="checkbox"
                  checked={allIncluded}
                  onChange={toggleAllIncluded}
                  title="Include/exclude all lines"
                  className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                />
              </th>
            )}
            <th className="text-left py-2 font-medium text-gray-600 w-24">
              Type
            </th>
            <th className="text-left py-2 font-medium text-gray-600">
              Name / Description
            </th>
            <th className="text-right py-2 font-medium text-gray-600 w-20">
              Qty
            </th>
            <th className="text-right py-2 font-medium text-gray-600 w-28">
              Unit Price
            </th>
            <th className="text-right py-2 font-medium text-gray-600 w-28">
              Total
            </th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr
              key={i}
              className={clsx(
                "border-b border-gray-100",
                showIncludeToggle && !isIncluded(item) && "opacity-60",
              )}
            >
              {showIncludeToggle && (
                <td className="py-2 pr-2">
                  <input
                    type="checkbox"
                    checked={isIncluded(item)}
                    onChange={() => {
                      toggleInclude(i);
                    }}
                    title="Include on the invoice and customer PDF/email"
                    className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                </td>
              )}
              <td className="py-2 pr-2">
                <select
                  value={item.type}
                  onChange={(e) => {
                    updateItem(i, "type", e.target.value);
                  }}
                  className="w-full text-xs border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  {lineItemTypes.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-2 pr-2">
                <input
                  type="text"
                  value={item.name}
                  onChange={(e) => {
                    updateItem(i, "name", e.target.value);
                  }}
                  placeholder="Item name"
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-500 mb-1"
                />
                <input
                  type="text"
                  value={item.description ?? ""}
                  onChange={(e) => {
                    updateItem(i, "description", e.target.value);
                  }}
                  placeholder="Description (optional)"
                  className="w-full text-xs border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500 text-gray-500"
                />
              </td>
              <td className="py-2 pr-2">
                <NumberInput
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={item.quantity}
                  onChange={(n) => {
                    updateItem(i, "quantity", n ?? 0);
                  }}
                  className="w-full text-right text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </td>
              <td className="py-2 pr-2">
                <NumberInput
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={item.unitPrice}
                  onChange={(n) => {
                    updateItem(i, "unitPrice", n ?? 0);
                  }}
                  className="w-full text-right text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </td>
              <td className="py-2 pr-2 text-right font-medium text-gray-900">
                {formatCurrency(item.total)}
              </td>
              <td className="py-2">
                <button
                  type="button"
                  onClick={() => {
                    removeItem(i);
                  }}
                  className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-3 flex items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={<PlusIcon className="h-4 w-4" />}
          onClick={addItem}
        >
          Add Line Item
        </Button>
        <p className="text-sm text-gray-500">
          Subtotal:{" "}
          <span className="font-semibold text-gray-900">
            {formatCurrency(subtotal)}
          </span>
        </p>
      </div>
    </div>
  );
}

// Lets a user pick a catalog item instead of typing a line from scratch. When
// `customerId` is given, prices reflect that customer's pricing tier.
//
// Searches the pricebook server-side (name/SKU/description) as you type,
// rather than loading the entire catalog into one giant <select> -- with a
// real catalog (hundreds or thousands of items) that dropdown becomes
// unusable. Nothing is fetched until at least 2 characters are typed.
function PricebookQuickAdd({
  customerId,
  onAdd,
}: {
  customerId?: string;
  onAdd: (item: LineItem) => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selected, setSelected] = useState<PricebookItem | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [query]);

  const searching = debouncedQuery.length >= 2;
  const { data: pricebookItems, isFetching } = usePricebookItems(
    { customerId, search: debouncedQuery },
    { enabled: searching },
  );
  const results = searching ? (pricebookItems ?? []) : [];

  const handleAdd = () => {
    if (!selected) return;
    const price = selected.effectivePrice ?? selected.unitPrice;
    onAdd({
      type: selected.type,
      name: selected.name,
      description: selected.description,
      quantity: 1,
      unitPrice: price,
      total: price,
    });
    setSelected(null);
    setQuery("");
    setDebouncedQuery("");
  };

  return (
    <div className="mb-3 flex items-center gap-2">
      <Combobox
        value={selected}
        onChange={(item: PricebookItem | null) => {
          setSelected(item);
        }}
      >
        <div className="relative flex-1">
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Combobox.Input
              className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-9 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="Search pricebook to add an item…"
              displayValue={(item: PricebookItem | null) => item?.name ?? ""}
              onChange={(event) => {
                setQuery(event.target.value);
                if (selected) setSelected(null);
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
          >
            <Combobox.Options className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-gray-200 bg-white py-1 text-sm shadow-lg focus:outline-none">
              {query.length > 0 && !searching ? (
                <div className="px-3.5 py-2 text-gray-400">
                  Keep typing to search…
                </div>
              ) : searching && isFetching ? (
                <div className="px-3.5 py-2 text-gray-400">Searching…</div>
              ) : searching && results.length === 0 ? (
                <div className="px-3.5 py-2 text-gray-400">
                  No pricebook items match "{debouncedQuery}".
                </div>
              ) : !searching ? (
                <div className="px-3.5 py-2 text-gray-400">
                  Type at least 2 characters to search the pricebook…
                </div>
              ) : (
                results.map((item) => {
                  const price = item.effectivePrice ?? item.unitPrice;
                  const discounted =
                    item.effectivePrice !== undefined &&
                    item.effectivePrice !== item.unitPrice;
                  return (
                    <Combobox.Option
                      key={item.id}
                      value={item}
                      className={({ active }) =>
                        clsx(
                          "cursor-pointer select-none px-3.5 py-2",
                          active
                            ? "bg-primary-50 text-primary-900"
                            : "text-gray-900",
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
                            {item.name}
                            {item.sku && (
                              <span className="ml-1.5 text-xs text-gray-400">
                                {item.sku}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-gray-500">
                            {formatCurrency(price)}
                            {discounted && (
                              <span className="ml-1 text-xs text-gray-400">
                                (catalog {formatCurrency(item.unitPrice)})
                              </span>
                            )}
                          </span>
                        </div>
                      )}
                    </Combobox.Option>
                  );
                })
              )}
            </Combobox.Options>
          </Transition>
        </div>
      </Combobox>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAdd}
        disabled={!selected}
      >
        Add
      </Button>
    </div>
  );
}
