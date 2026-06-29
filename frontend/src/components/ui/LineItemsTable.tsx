import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { formatCurrency } from '../../utils/formatters';
import Button from './Button';

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
}

const LINE_ITEM_TYPES = ['service', 'part', 'labor', 'other'];

export default function LineItemsTable({ items, onChange, readonly = false }: LineItemsTableProps) {
  const addItem = () => {
    onChange([
      ...items,
      { type: 'service', name: '', quantity: 1, unitPrice: 0, total: 0 },
    ]);
  };

  const removeItem = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: keyof LineItem, value: string | number) => {
    const updated = items.map((item, i) => {
      if (i !== index) return item;
      const next = { ...item, [field]: value };
      if (field === 'quantity' || field === 'unitPrice') {
        next.total = Number(next.quantity) * Number(next.unitPrice);
      }
      return next;
    });
    onChange(updated);
  };

  const subtotal = items.reduce((sum, item) => sum + item.total, 0);

  if (readonly) {
    return (
      <div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 font-medium text-gray-600 w-1/2">Item</th>
              <th className="text-right py-2 font-medium text-gray-600">Qty</th>
              <th className="text-right py-2 font-medium text-gray-600">Unit Price</th>
              <th className="text-right py-2 font-medium text-gray-600">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i} className="border-b border-gray-100">
                <td className="py-3">
                  <p className="font-medium text-gray-900">{item.name}</p>
                  {item.description && <p className="text-gray-500 text-xs mt-0.5">{item.description}</p>}
                </td>
                <td className="text-right py-3 text-gray-700">{item.quantity}</td>
                <td className="text-right py-3 text-gray-700">{formatCurrency(item.unitPrice)}</td>
                <td className="text-right py-3 font-medium text-gray-900">{formatCurrency(item.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 font-medium text-gray-600 w-24">Type</th>
            <th className="text-left py-2 font-medium text-gray-600">Name / Description</th>
            <th className="text-right py-2 font-medium text-gray-600 w-20">Qty</th>
            <th className="text-right py-2 font-medium text-gray-600 w-28">Unit Price</th>
            <th className="text-right py-2 font-medium text-gray-600 w-28">Total</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="py-2 pr-2">
                <select
                  value={item.type}
                  onChange={(e) => updateItem(i, 'type', e.target.value)}
                  className="w-full text-xs border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-500"
                >
                  {LINE_ITEM_TYPES.map((t) => (
                    <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                  ))}
                </select>
              </td>
              <td className="py-2 pr-2">
                <input
                  type="text"
                  value={item.name}
                  onChange={(e) => updateItem(i, 'name', e.target.value)}
                  placeholder="Item name"
                  className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-500 mb-1"
                />
                <input
                  type="text"
                  value={item.description || ''}
                  onChange={(e) => updateItem(i, 'description', e.target.value)}
                  placeholder="Description (optional)"
                  className="w-full text-xs border border-gray-200 rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-500 text-gray-500"
                />
              </td>
              <td className="py-2 pr-2">
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={item.quantity}
                  onChange={(e) => updateItem(i, 'quantity', parseFloat(e.target.value) || 0)}
                  className="w-full text-right text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </td>
              <td className="py-2 pr-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.unitPrice}
                  onChange={(e) => updateItem(i, 'unitPrice', parseFloat(e.target.value) || 0)}
                  className="w-full text-right text-sm border border-gray-300 rounded-md px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </td>
              <td className="py-2 pr-2 text-right font-medium text-gray-900">
                {formatCurrency(item.total)}
              </td>
              <td className="py-2">
                <button
                  type="button"
                  onClick={() => removeItem(i)}
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
          Subtotal: <span className="font-semibold text-gray-900">{formatCurrency(subtotal)}</span>
        </p>
      </div>
    </div>
  );
}
