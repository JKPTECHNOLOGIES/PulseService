import { useState } from "react";
import { PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { formatCurrency } from "../../utils/formatters";
import { useLookup } from "../../hooks/useMetadata";
import { usePricebookItems } from "../../hooks/usePricebook";
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
}

interface LineItemsTableProps {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
  readonly?: boolean;
  /** When given, the pricebook quick-add picker shows that customer's
   * tier-adjusted price instead of the raw catalog price. */
  customerId?: string;
}

export default function LineItemsTable({
  items,
  onChange,
  readonly = false,
  customerId,
}: LineItemsTableProps) {
  const { options: lineItemTypes } = useLookup("lineItemType");
  const addItem = () => {
    onChange([
      ...items,
      { type: "service", name: "", quantity: 1, unitPrice: 0, total: 0 },
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

  const subtotal = items.reduce((sum, item) => sum + item.total, 0);

  if (readonly) {
    return (
      <div>
        {/* Mobile: stacked cards (the table overflows a phone width) */}
        <div className="md:hidden space-y-2">
          {items.map((item, i) => (
            <div key={i} className="rounded-lg border border-gray-100 p-3">
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
            </div>
          ))}
        </div>
        {/* Desktop: table */}
        <table className="hidden md:table w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
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
              <tr key={i} className="border-b border-gray-100">
                <td className="py-3">
                  <p className="font-medium text-gray-900">{item.name}</p>
                  {item.description && (
                    <p className="text-gray-500 text-xs mt-0.5">
                      {item.description}
                    </p>
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
          onChange([...items, item]);
        }}
      />
      {/* Mobile: stacked editable cards (the 6-column table is unusable on a
          phone). Desktop keeps the table below. */}
      <div className="md:hidden space-y-3">
        {items.map((item, i) => (
          <div
            key={i}
            className="rounded-lg border border-gray-200 p-3 space-y-2"
          >
            <div className="flex items-center gap-2">
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
            <tr key={i} className="border-b border-gray-100">
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
function PricebookQuickAdd({
  customerId,
  onAdd,
}: {
  customerId?: string;
  onAdd: (item: LineItem) => void;
}) {
  const { data: pricebookItems } = usePricebookItems({ customerId });
  const [selectedId, setSelectedId] = useState("");

  if (!pricebookItems || pricebookItems.length === 0) return null;

  const handleAdd = () => {
    const item = pricebookItems.find((i) => i.id === selectedId);
    if (!item) return;
    const price = item.effectivePrice ?? item.unitPrice;
    onAdd({
      type: item.type,
      name: item.name,
      description: item.description,
      quantity: 1,
      unitPrice: price,
      total: price,
    });
    setSelectedId("");
  };

  return (
    <div className="mb-3 flex items-center gap-2">
      <select
        value={selectedId}
        onChange={(e) => {
          setSelectedId(e.target.value);
        }}
        className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white"
      >
        <option value="">Add from pricebook…</option>
        {pricebookItems.map((i) => {
          const price = i.effectivePrice ?? i.unitPrice;
          const discounted =
            i.effectivePrice !== undefined && i.effectivePrice !== i.unitPrice;
          return (
            <option key={i.id} value={i.id}>
              {i.name} — {formatCurrency(price)}
              {discounted ? ` (catalog ${formatCurrency(i.unitPrice)})` : ""}
            </option>
          );
        })}
      </select>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAdd}
        disabled={!selectedId}
      >
        Add
      </Button>
    </div>
  );
}
