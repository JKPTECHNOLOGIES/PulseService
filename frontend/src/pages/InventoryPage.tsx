import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  ExclamationTriangleIcon,
  AdjustmentsHorizontalIcon,
  ClockIcon,
  PhotoIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import {
  useInventoryItems,
  useAdjustInventory,
  useInventoryTransactions,
} from "../hooks/useInventory";
import Button from "../components/ui/Button";
import Modal from "../components/ui/Modal";
import AttachmentGallery from "../components/ui/AttachmentGallery";
import EmptyState from "../components/ui/EmptyState";
import { PageSpinner } from "../components/ui/Spinner";
import { formatCurrency, formatDateTime } from "../utils/formatters";
import { useLookup } from "../hooks/useMetadata";
import { InventoryItem } from "../types";

interface AdjustForm {
  type: "add" | "remove" | "adjust";
  quantity: number;
  notes?: string;
}

export default function InventoryPage() {
  const { data: items, isLoading } = useInventoryItems();
  const adjustMutation = useAdjustInventory();

  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
  const [txItem, setTxItem] = useState<InventoryItem | null>(null);
  const [photoItem, setPhotoItem] = useState<InventoryItem | null>(null);

  const { register, handleSubmit, reset } = useForm<AdjustForm>({
    defaultValues: { type: "add", quantity: 0 },
  });
  const { getLabel: getTxTypeLabel } = useLookup("inventoryTransactionType");

  const { data: transactions } = useInventoryTransactions(txItem?.id ?? "");

  const lowStockItems = (items ?? []).filter(
    (i) => i.quantity <= i.reorderPoint,
  );

  const onAdjust = async (data: AdjustForm) => {
    if (!adjustItem) return;
    await adjustMutation.mutateAsync({
      itemId: adjustItem.id,
      quantity: data.quantity,
      type: data.type,
      notes: data.notes,
    });
    setAdjustItem(null);
    reset({ type: "add", quantity: 0 });
  };

  if (isLoading) return <PageSpinner />;

  return (
    <div className="space-y-5">
      {/* Low stock alert */}
      {lowStockItems.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-5 py-3 flex items-center gap-3">
          <ExclamationTriangleIcon className="h-5 w-5 text-yellow-600 shrink-0" />
          <p className="text-sm text-yellow-800">
            <span className="font-semibold">
              {lowStockItems.length} item(s)
            </span>{" "}
            below reorder point: {lowStockItems.map((i) => i.name).join(", ")}
          </p>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {!items || items.length === 0 ? (
          <EmptyState
            title="No inventory items"
            description="Inventory items will appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left py-3 px-5 font-medium text-gray-500 text-xs uppercase">
                    SKU
                  </th>
                  <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                    Name
                  </th>
                  <th className="text-right py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                    Quantity
                  </th>
                  <th className="text-right py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                    Reorder Pt
                  </th>
                  <th className="text-right py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                    Unit Cost
                  </th>
                  <th className="text-left py-3 px-3 font-medium text-gray-500 text-xs uppercase">
                    Location
                  </th>
                  <th className="text-right py-3 px-5 font-medium text-gray-500 text-xs uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {items.map((item) => {
                  const lowStock = item.quantity <= item.reorderPoint;
                  return (
                    <tr
                      key={item.id}
                      className={clsx(
                        "transition-colors",
                        lowStock
                          ? "bg-yellow-50 hover:bg-yellow-100"
                          : "hover:bg-gray-50",
                      )}
                    >
                      <td className="py-3.5 px-5 font-mono text-xs text-gray-600">
                        {item.sku}
                      </td>
                      <td className="py-3.5 px-3 font-medium text-gray-900">
                        {item.name}
                      </td>
                      <td className="py-3.5 px-3 text-right">
                        <span
                          className={clsx(
                            "font-semibold",
                            lowStock ? "text-yellow-700" : "text-gray-900",
                          )}
                        >
                          {item.quantity}
                        </span>
                      </td>
                      <td className="py-3.5 px-3 text-right text-gray-500">
                        {item.reorderPoint}
                      </td>
                      <td className="py-3.5 px-3 text-right text-gray-600">
                        {formatCurrency(item.unitCost)}
                      </td>
                      <td className="py-3.5 px-3 text-gray-500 text-xs">
                        {item.location ?? "-"}
                      </td>
                      <td className="py-3.5 px-5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => {
                              reset({ type: "add", quantity: 0 });
                              setAdjustItem(item);
                            }}
                            className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                            title="Adjust"
                          >
                            <AdjustmentsHorizontalIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => {
                              setPhotoItem(item);
                            }}
                            className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg"
                            title="Photos"
                          >
                            <PhotoIcon className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => {
                              setTxItem(item);
                            }}
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                            title="Transactions"
                          >
                            <ClockIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Adjust Modal */}
      <Modal
        isOpen={!!adjustItem}
        onClose={() => {
          setAdjustItem(null);
        }}
        title={`Adjust: ${adjustItem?.name ?? ""}`}
      >
        <form
          onSubmit={(e) => void handleSubmit(onAdjust)(e)}
          className="space-y-4"
        >
          <p className="text-sm text-gray-500">
            Current quantity:{" "}
            <span className="font-semibold text-gray-900">
              {adjustItem?.quantity}
            </span>
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Adjustment Type
            </label>
            <select
              {...register("type")}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
            >
              <option value="add">Add Stock (+)</option>
              <option value="remove">Remove Stock (-)</option>
              <option value="adjust">Set Exact Quantity</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Quantity
            </label>
            <input
              type="number"
              {...register("quantity", { valueAsNumber: true })}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Notes
            </label>
            <textarea
              {...register("notes")}
              rows={2}
              className="w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setAdjustItem(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={adjustMutation.isPending}>
              Apply Adjustment
            </Button>
          </div>
        </form>
      </Modal>

      {/* Transactions Modal */}
      <Modal
        isOpen={!!txItem}
        onClose={() => {
          setTxItem(null);
        }}
        title={`Transactions: ${txItem?.name ?? ""}`}
        size="lg"
      >
        {transactions && transactions.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 font-medium text-gray-500 text-xs">
                  DATE
                </th>
                <th className="text-left py-2 font-medium text-gray-500 text-xs">
                  TYPE
                </th>
                <th className="text-right py-2 font-medium text-gray-500 text-xs">
                  QTY
                </th>
                <th className="text-left py-2 font-medium text-gray-500 text-xs">
                  NOTES
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td className="py-2.5 text-gray-700">
                    {formatDateTime(tx.createdAt)}
                  </td>
                  <td className="py-2.5 text-gray-700">
                    {getTxTypeLabel(tx.type)}
                  </td>
                  <td className="py-2.5 text-right font-medium">
                    {tx.quantity}
                  </td>
                  <td className="py-2.5 text-gray-500">{tx.notes ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-400 py-4 text-center">
            No transactions recorded
          </p>
        )}
      </Modal>

      {/* Photos Modal */}
      <Modal
        isOpen={!!photoItem}
        onClose={() => {
          setPhotoItem(null);
        }}
        title={`Photos: ${photoItem?.name ?? ""}`}
        size="lg"
      >
        {photoItem && (
          <AttachmentGallery entityType="inventory" entityId={photoItem.id} />
        )}
      </Modal>
    </div>
  );
}
