import { useState, lazy, Suspense } from "react";
import { useForm } from "react-hook-form";
import {
  ExclamationTriangleIcon,
  AdjustmentsHorizontalIcon,
  ClockIcon,
  PhotoIcon,
  QrCodeIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import toast from "react-hot-toast";
import {
  useInventoryItems,
  useAdjustInventory,
  useInventoryTransactions,
} from "../hooks/useInventory";
import Button from "../components/ui/Button";
import IconButton from "../components/ui/IconButton";
import Modal from "../components/ui/Modal";
import AttachmentGallery from "../components/ui/AttachmentGallery";
import EmptyState from "../components/ui/EmptyState";
import DataTable, { Column, SortState } from "../components/ui/DataTable";
import { TableSkeleton } from "../components/ui/Skeleton";
import { formatCurrency, formatDateTime } from "../utils/formatters";
import { useLookup } from "../hooks/useMetadata";
import { InventoryItem } from "../types";

// Lazy-loaded so the ~400KB @zxing barcode library only downloads when a user
// actually opens the scanner, keeping the Inventory route chunk small.
const BarcodeScanner = lazy(() => import("../components/ui/BarcodeScanner"));

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
  const [scannerOpen, setScannerOpen] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);

  // Scanned barcode -> match an item by SKU and open its adjust dialog.
  const handleScan = (code: string) => {
    const term = code.trim().toLowerCase();
    const match = (items ?? []).find((i) => i.sku.toLowerCase() === term);
    if (match) {
      reset({ type: "add", quantity: 0 });
      setAdjustItem(match);
    } else {
      toast.error(`No inventory item with SKU \u201C${code}\u201D`);
    }
  };

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

  const columns: Column<InventoryItem>[] = [
    {
      key: "sku",
      header: "SKU",
      sortValue: (item) => item.sku,
      exportValue: (item) => item.sku,
      render: (item) => (
        <span className="font-mono text-xs text-gray-600">{item.sku}</span>
      ),
    },
    {
      key: "name",
      header: "Name",
      sortValue: (item) => item.name.toLowerCase(),
      exportValue: (item) => item.name,
      render: (item) => (
        <span className="font-medium text-gray-900">{item.name}</span>
      ),
    },
    {
      key: "quantity",
      header: "Quantity",
      align: "right",
      sortValue: (item) => item.quantity,
      exportValue: (item) => item.quantity,
      render: (item) => (
        <span
          className={clsx(
            "font-semibold",
            item.quantity <= item.reorderPoint
              ? "text-yellow-700"
              : "text-gray-900",
          )}
        >
          {item.quantity}
        </span>
      ),
    },
    {
      key: "reorderPoint",
      header: "Reorder Pt",
      align: "right",
      sortValue: (item) => item.reorderPoint,
      exportValue: (item) => item.reorderPoint,
      render: (item) => (
        <span className="text-gray-500">{item.reorderPoint}</span>
      ),
    },
    {
      key: "unitCost",
      header: "Unit Cost",
      align: "right",
      sortValue: (item) => item.unitCost,
      exportValue: (item) => item.unitCost,
      render: (item) => (
        <span className="text-gray-600">{formatCurrency(item.unitCost)}</span>
      ),
    },
    {
      key: "location",
      header: "Location",
      sortValue: (item) => item.location ?? "",
      exportValue: (item) => item.location ?? "",
      render: (item) => (
        <span className="text-gray-500 text-xs">{item.location ?? "-"}</span>
      ),
    },
  ];

  const itemActions = (item: InventoryItem) => (
    <>
      <IconButton
        label="Adjust stock"
        onClick={() => {
          reset({ type: "add", quantity: 0 });
          setAdjustItem(item);
        }}
      >
        <AdjustmentsHorizontalIcon className="h-4 w-4" />
      </IconButton>
      <IconButton
        label="Photos"
        onClick={() => {
          setPhotoItem(item);
        }}
      >
        <PhotoIcon className="h-4 w-4" />
      </IconButton>
      <IconButton
        label="Transactions"
        onClick={() => {
          setTxItem(item);
        }}
      >
        <ClockIcon className="h-4 w-4" />
      </IconButton>
    </>
  );

  if (isLoading) return <TableSkeleton rows={8} />;

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{items?.length ?? 0} items</p>
        <Button
          size="sm"
          icon={<QrCodeIcon className="h-4 w-4" />}
          onClick={() => {
            setScannerOpen(true);
          }}
        >
          Scan
        </Button>
      </div>

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
          <DataTable<InventoryItem>
            columns={columns}
            rows={items}
            getRowId={(item) => item.id}
            sort={sort}
            onSortChange={setSort}
            csvFilename="inventory"
            rowActions={itemActions}
            rowClassName={(item) =>
              item.quantity <= item.reorderPoint &&
              "bg-yellow-50 hover:bg-yellow-100"
            }
            renderMobileCard={(item) => (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-gray-900 truncate">
                    {item.name}
                  </p>
                  <span
                    className={clsx(
                      "font-semibold text-sm shrink-0",
                      item.quantity <= item.reorderPoint
                        ? "text-yellow-700"
                        : "text-gray-900",
                    )}
                  >
                    {item.quantity} on hand
                  </span>
                </div>
                <p className="font-mono text-xs text-gray-500 mt-0.5">
                  {item.sku}
                </p>
                <div className="mt-0.5 text-xs text-gray-500">
                  Reorder at {item.reorderPoint} ·{" "}
                  {formatCurrency(item.unitCost)}
                  {item.location ? ` · ${item.location}` : ""}
                </div>
              </div>
            )}
          />
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

      {/* Mounted only while open so its heavy camera library is fetched on
          demand rather than bundled into the Inventory route chunk. */}
      {scannerOpen && (
        <Suspense fallback={null}>
          <BarcodeScanner
            isOpen
            onClose={() => {
              setScannerOpen(false);
            }}
            onDetected={handleScan}
          />
        </Suspense>
      )}
    </div>
  );
}
