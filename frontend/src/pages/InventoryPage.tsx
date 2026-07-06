import { useState, lazy, Suspense } from "react";
import { Link } from "react-router-dom";
import {
  ExclamationTriangleIcon,
  AdjustmentsHorizontalIcon,
  ArrowsRightLeftIcon,
  ClockIcon,
  PhotoIcon,
  QrCodeIcon,
  PlusIcon,
  PencilSquareIcon,
  ArrowUpTrayIcon,
  BuildingStorefrontIcon,
  ClipboardDocumentListIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import toast from "react-hot-toast";
import {
  useInventoryItems,
  useInventoryItem,
  useStockLocations,
  useAdjustInventory,
  useTransferInventory,
  useInventoryTransactions,
  useSaveInventoryItem,
  useAddItemSupplier,
  useRemoveItemSupplier,
} from "../hooks/useInventory";
import { useSuppliers } from "../hooks/useSuppliers";
import ImportModal from "../components/ui/ImportModal";
import Button from "../components/ui/Button";
import IconButton from "../components/ui/IconButton";
import Modal from "../components/ui/Modal";
import AttachmentGallery from "../components/ui/AttachmentGallery";
import EmptyState from "../components/ui/EmptyState";
import DataTable, { Column, SortState } from "../components/ui/DataTable";
import { TableSkeleton } from "../components/ui/Skeleton";
import { Can } from "../components/ui/Can";
import { NumberInput } from "../components/ui/NumberInput";
import { formatCurrency, formatDateTime } from "../utils/formatters";
import { useLookup } from "../hooks/useMetadata";
import type { InventoryItem } from "../types";

const BarcodeScanner = lazy(() => import("../components/ui/BarcodeScanner"));

const num = (v: unknown) => Number(v ?? 0);

export default function InventoryPage() {
  const [search, setSearch] = useState("");
  const { data: items, isLoading } = useInventoryItems(
    search ? { search } : {},
  );
  const { data: locations } = useStockLocations({ active: "true" });
  const adjustMutation = useAdjustInventory();
  const transferMutation = useTransferInventory();
  const saveItem = useSaveInventoryItem();

  const [adjustItem, setAdjustItem] = useState<InventoryItem | null>(null);
  const [transferItem, setTransferItem] = useState<InventoryItem | null>(null);
  const [txItem, setTxItem] = useState<InventoryItem | null>(null);
  const [photoItem, setPhotoItem] = useState<InventoryItem | null>(null);
  const [formItem, setFormItem] = useState<Partial<InventoryItem> | null>(null);
  const [supplierItem, setSupplierItem] = useState<InventoryItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);

  const { getLabel: getTxTypeLabel } = useLookup("inventoryTransactionType");
  const { data: transactions } = useInventoryTransactions(txItem?.id ?? "");

  const activeLocations = locations ?? [];
  const lowStockItems = (items ?? []).filter((i) => i.isLowStock);

  // Scanned barcode -> match an item by SKU and open its adjust dialog.
  const handleScan = (code: string) => {
    const term = code.trim().toLowerCase();
    const match = (items ?? []).find((i) => i.sku.toLowerCase() === term);
    if (match) setAdjustItem(match);
    else toast.error(`No inventory item with SKU \u201C${code}\u201D`);
  };

  const columns: Column<InventoryItem>[] = [
    {
      key: "sku",
      header: "SKU",
      sortValue: (i) => i.sku,
      exportValue: (i) => i.sku,
      render: (i) => (
        <span className="font-mono text-xs text-gray-600">{i.sku}</span>
      ),
    },
    {
      key: "name",
      header: "Name",
      sortValue: (i) => i.name.toLowerCase(),
      exportValue: (i) => i.name,
      render: (i) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">{i.name}</span>
          {i.isSerialized && (
            <span className="text-[10px] uppercase tracking-wide bg-indigo-100 text-indigo-700 rounded px-1.5 py-0.5">
              Serial
            </span>
          )}
        </div>
      ),
    },
    {
      key: "totalOnHand",
      header: "On Hand",
      align: "right",
      sortValue: (i) => num(i.totalOnHand),
      exportValue: (i) => num(i.totalOnHand),
      render: (i) => (
        <span
          className={clsx(
            "font-semibold",
            i.isLowStock ? "text-yellow-700" : "text-gray-900",
          )}
        >
          {num(i.totalOnHand)}
        </span>
      ),
    },
    {
      key: "locations",
      header: "Locations",
      align: "right",
      sortValue: (i) => i.stock?.length ?? 0,
      exportValue: (i) => i.stock?.length ?? 0,
      render: (i) => (
        <span className="text-gray-500 text-xs">
          {(i.stock ?? []).filter((s) => num(s.quantityOnHand) > 0).length}
        </span>
      ),
    },
    {
      key: "reorderPoint",
      header: "Reorder Pt",
      align: "right",
      sortValue: (i) => num(i.reorderPoint),
      exportValue: (i) => num(i.reorderPoint),
      render: (i) => (
        <span className="text-gray-500">{num(i.reorderPoint)}</span>
      ),
    },
    {
      key: "unitCost",
      header: "Avg Cost",
      align: "right",
      sortValue: (i) => num(i.unitCost),
      exportValue: (i) => num(i.unitCost),
      render: (i) => (
        <span className="text-gray-600">{formatCurrency(num(i.unitCost))}</span>
      ),
    },
  ];

  const itemActions = (item: InventoryItem) => (
    <>
      <Can permission="inventory.manage">
        <IconButton
          label="Adjust stock"
          onClick={() => {
            setAdjustItem(item);
          }}
        >
          <AdjustmentsHorizontalIcon className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="Transfer"
          onClick={() => {
            setTransferItem(item);
          }}
        >
          <ArrowsRightLeftIcon className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="Edit"
          onClick={() => {
            setFormItem(item);
          }}
        >
          <PencilSquareIcon className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="Supplier pricing"
          onClick={() => {
            setSupplierItem(item);
          }}
        >
          <BuildingStorefrontIcon className="h-4 w-4" />
        </IconButton>
      </Can>
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            placeholder="Search SKU or name..."
            className="px-3.5 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 w-64"
          />
          <p className="text-sm text-gray-500">{items?.length ?? 0} items</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/inventory/locations">
            <Button
              size="sm"
              variant="outline"
              icon={<BuildingStorefrontIcon className="h-4 w-4" />}
            >
              Locations
            </Button>
          </Link>
          <Can permission="inventory.manage">
            <Link to="/inventory/cycle-count">
              <Button
                size="sm"
                variant="outline"
                icon={<ClipboardDocumentListIcon className="h-4 w-4" />}
              >
                Cycle Count
              </Button>
            </Link>
          </Can>
          <Button
            size="sm"
            variant="outline"
            icon={<QrCodeIcon className="h-4 w-4" />}
            onClick={() => {
              setScannerOpen(true);
            }}
          >
            Scan
          </Button>
          <Can permission="inventory.manage">
            <Button
              size="sm"
              variant="outline"
              icon={<ArrowUpTrayIcon className="h-4 w-4" />}
              onClick={() => {
                setImportOpen(true);
              }}
            >
              Import
            </Button>
            <Button
              size="sm"
              icon={<PlusIcon className="h-4 w-4" />}
              onClick={() => {
                setFormItem({});
              }}
            >
              New Item
            </Button>
          </Can>
        </div>
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
            getRowId={(i) => i.id}
            sort={sort}
            onSortChange={setSort}
            csvFilename="inventory"
            rowActions={itemActions}
            rowClassName={(i) =>
              i.isLowStock ? "bg-yellow-50 hover:bg-yellow-100" : undefined
            }
            renderMobileCard={(i) => (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium text-gray-900 truncate">{i.name}</p>
                  <span
                    className={clsx(
                      "font-semibold text-sm shrink-0",
                      i.isLowStock ? "text-yellow-700" : "text-gray-900",
                    )}
                  >
                    {num(i.totalOnHand)} on hand
                  </span>
                </div>
                <p className="font-mono text-xs text-gray-500 mt-0.5">
                  {i.sku}
                </p>
                <div className="mt-0.5 text-xs text-gray-500">
                  Reorder at {num(i.reorderPoint)} ·{" "}
                  {formatCurrency(num(i.unitCost))} avg
                </div>
              </div>
            )}
          />
        )}
      </div>

      {/* Adjust modal */}
      <AdjustModal
        item={adjustItem}
        locations={activeLocations}
        pending={adjustMutation.isPending}
        onClose={() => {
          setAdjustItem(null);
        }}
        onSubmit={async (payload) => {
          if (!adjustItem) return;
          await adjustMutation.mutateAsync({
            itemId: adjustItem.id,
            ...payload,
          });
          setAdjustItem(null);
        }}
      />

      {/* Transfer modal */}
      <TransferModal
        item={transferItem}
        locations={activeLocations}
        pending={transferMutation.isPending}
        onClose={() => {
          setTransferItem(null);
        }}
        onSubmit={async (payload) => {
          if (!transferItem) return;
          await transferMutation.mutateAsync({
            itemId: transferItem.id,
            ...payload,
          });
          setTransferItem(null);
        }}
      />

      {/* Item create/edit modal */}
      <ItemFormModal
        item={formItem}
        pending={saveItem.isPending}
        onClose={() => {
          setFormItem(null);
        }}
        onSubmit={async (payload) => {
          await saveItem.mutateAsync(payload);
          setFormItem(null);
        }}
      />

      {/* Transactions modal */}
      <Modal
        isOpen={!!txItem}
        onClose={() => {
          setTxItem(null);
        }}
        title={`Stock activity: ${txItem?.name ?? ""}`}
        size="lg"
      >
        {/* Per-location breakdown */}
        {txItem?.stock && txItem.stock.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-2">
            {txItem.stock.map((s) => (
              <span
                key={s.id}
                className="text-xs bg-gray-100 rounded-lg px-2.5 py-1 text-gray-700"
              >
                {s.stockLocation?.code ?? "?"}:{" "}
                <span className="font-semibold">{num(s.quantityOnHand)}</span>
              </span>
            ))}
          </div>
        )}
        {transactions && transactions.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="py-2 font-medium">DATE</th>
                <th className="py-2 font-medium">TYPE</th>
                <th className="py-2 font-medium">LOCATION</th>
                <th className="py-2 font-medium text-right">QTY</th>
                <th className="py-2 font-medium">NOTES</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {transactions.map((tx) => (
                <tr key={tx.id}>
                  <td className="py-2.5 text-gray-700">
                    {formatDateTime(tx.transactionDate)}
                  </td>
                  <td className="py-2.5 text-gray-700">
                    {getTxTypeLabel(tx.type)}
                  </td>
                  <td className="py-2.5 text-gray-500 text-xs">
                    {tx.stockLocation?.code ?? "-"}
                  </td>
                  <td
                    className={clsx(
                      "py-2.5 text-right font-medium",
                      num(tx.quantity) < 0 ? "text-red-600" : "text-green-700",
                    )}
                  >
                    {num(tx.quantity) > 0 ? "+" : ""}
                    {num(tx.quantity)}
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

      {/* Photos modal */}
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

      {/* Supplier pricing modal */}
      <SupplierPricingModal
        item={supplierItem}
        onClose={() => {
          setSupplierItem(null);
        }}
      />

      {/* CSV import */}
      <ImportModal
        isOpen={importOpen}
        onClose={() => {
          setImportOpen(false);
        }}
        title="Import inventory items"
        endpoint="/inventory/items/import"
        invalidateKey={["inventory"]}
        templateColumns={[
          "sku",
          "name",
          "unit",
          "quantity",
          "unitCost",
          "reorderPoint",
          "reorderQuantity",
          "supplierName",
          "locationCode",
          "serialized",
        ]}
      />

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

// ─── Supplier pricing modal ──────────────────────────────────────────────────────

function SupplierPricingModal({
  item,
  onClose,
}: {
  item: InventoryItem | null;
  onClose: () => void;
}) {
  const { data: detail } = useInventoryItem(item?.id ?? "");
  const { data: suppliers } = useSuppliers({ active: "true" });
  const addLink = useAddItemSupplier();
  const removeLink = useRemoveItemSupplier();

  const [supplierId, setSupplierId] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [supplierSku, setSupplierSku] = useState("");

  if (!item) return null;

  const links = detail?.suppliers ?? [];
  const linkedIds = new Set(links.map((l) => l.supplierId));
  const addable = (suppliers ?? []).filter((s) => !linkedIds.has(s.id));

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Supplier pricing: ${item.name}`}
      size="lg"
    >
      <div className="space-y-4">
        <p className="text-sm text-gray-500">
          Current average cost:{" "}
          <span className="font-semibold text-gray-900">
            {formatCurrency(num(item.unitCost))}
          </span>
        </p>

        {links.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="py-2 font-medium">Supplier</th>
                <th className="py-2 font-medium">Supplier SKU</th>
                <th className="py-2 font-medium text-right">Price</th>
                <th className="py-2 font-medium">Primary</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {links.map((l) => (
                <tr key={l.id}>
                  <td className="py-2.5 text-gray-900 font-medium">
                    {l.supplier?.name ?? "-"}
                  </td>
                  <td className="py-2.5 font-mono text-xs text-gray-500">
                    {l.supplierSku ?? "-"}
                  </td>
                  <td className="py-2.5 text-right text-gray-700">
                    {formatCurrency(num(l.unitCost))}
                  </td>
                  <td className="py-2.5 text-xs">
                    {l.isPrimary ? (
                      <span className="text-primary-600 font-medium">
                        Primary
                      </span>
                    ) : (
                      <span className="text-gray-300">—</span>
                    )}
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => {
                        removeLink.mutate({ itemId: item.id, linkId: l.id });
                      }}
                      className="p-1.5 text-gray-400 hover:text-red-500"
                      aria-label="Remove supplier price"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-400">No supplier prices yet.</p>
        )}

        {/* Add a supplier price */}
        <div className="border-t border-gray-100 pt-4 grid grid-cols-12 gap-2 items-end">
          <div className="col-span-5">
            <label className="block text-xs text-gray-500 mb-1">Supplier</label>
            <select
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
              }}
              className={INPUT}
            >
              <option value="">Select supplier...</option>
              {addable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-3">
            <label className="block text-xs text-gray-500 mb-1">
              Supplier SKU
            </label>
            <input
              value={supplierSku}
              onChange={(e) => {
                setSupplierSku(e.target.value);
              }}
              className={INPUT}
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs text-gray-500 mb-1">Price</label>
            <input
              type="number"
              step="any"
              min={0}
              value={unitCost}
              onChange={(e) => {
                setUnitCost(e.target.value);
              }}
              className={INPUT}
            />
          </div>
          <div className="col-span-2">
            <Button
              size="sm"
              className="w-full"
              loading={addLink.isPending}
              disabled={!supplierId || unitCost === ""}
              onClick={() => {
                void addLink
                  .mutateAsync({
                    itemId: item.id,
                    supplierId,
                    unitCost: Number(unitCost),
                    supplierSku: supplierSku || undefined,
                    isPrimary: links.length === 0,
                  })
                  .then(() => {
                    setSupplierId("");
                    setUnitCost("");
                    setSupplierSku("");
                  });
              }}
            >
              Add
            </Button>
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Adjust modal ────────────────────────────────────────────────────────────

interface LocationOpt {
  id: string;
  name: string;
  code: string;
}

function AdjustModal({
  item,
  locations,
  pending,
  onClose,
  onSubmit,
}: {
  item: InventoryItem | null;
  locations: LocationOpt[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (p: {
    stockLocationId: string;
    quantity: number;
    type: "add" | "remove" | "set";
    notes?: string;
  }) => Promise<void>;
}) {
  const [stockLocationId, setStockLocationId] = useState("");
  const [type, setType] = useState<"add" | "remove" | "set">("add");
  const [quantity, setQuantity] = useState(0);
  const [notes, setNotes] = useState("");

  const current =
    item?.stock?.find((s) => s.stockLocationId === stockLocationId)
      ?.quantityOnHand ?? 0;

  return (
    <Modal
      isOpen={!!item}
      onClose={onClose}
      title={`Adjust stock: ${item?.name ?? ""}`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!stockLocationId) {
            toast.error("Select a location");
            return;
          }
          void onSubmit({ stockLocationId, quantity, type, notes });
        }}
        className="space-y-4"
      >
        <Field label="Location">
          <select
            value={stockLocationId}
            onChange={(e) => {
              setStockLocationId(e.target.value);
            }}
            className={INPUT}
          >
            <option value="">Select location...</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.code})
              </option>
            ))}
          </select>
        </Field>
        {stockLocationId && (
          <p className="text-sm text-gray-500">
            Current at location:{" "}
            <span className="font-semibold text-gray-900">{num(current)}</span>
          </p>
        )}
        <Field label="Adjustment type">
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as "add" | "remove" | "set");
            }}
            className={INPUT}
          >
            <option value="add">Add stock (+)</option>
            <option value="remove">Remove stock (-)</option>
            <option value="set">Set exact quantity</option>
          </select>
        </Field>
        <Field label="Quantity">
          <NumberInput
            step="any"
            value={quantity}
            onChange={(n) => {
              setQuantity(n ?? 0);
            }}
            className={INPUT}
          />
        </Field>
        <Field label="Notes">
          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
            rows={2}
            className={clsx(INPUT, "resize-none")}
          />
        </Field>
        <div className="flex justify-end gap-3">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            Apply
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Transfer modal ──────────────────────────────────────────────────────────

function TransferModal({
  item,
  locations,
  pending,
  onClose,
  onSubmit,
}: {
  item: InventoryItem | null;
  locations: LocationOpt[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (p: {
    fromLocationId: string;
    toLocationId: string;
    quantity: number;
    notes?: string;
  }) => Promise<void>;
}) {
  const [fromLocationId, setFrom] = useState("");
  const [toLocationId, setTo] = useState("");
  const [quantity, setQuantity] = useState(0);
  const [notes, setNotes] = useState("");

  const available =
    item?.stock?.find((s) => s.stockLocationId === fromLocationId)
      ?.quantityOnHand ?? 0;

  return (
    <Modal
      isOpen={!!item}
      onClose={onClose}
      title={`Transfer: ${item?.name ?? ""}`}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!fromLocationId || !toLocationId) {
            toast.error("Select both locations");
            return;
          }
          if (fromLocationId === toLocationId) {
            toast.error("Source and destination must differ");
            return;
          }
          void onSubmit({ fromLocationId, toLocationId, quantity, notes });
        }}
        className="space-y-4"
      >
        <Field label="From">
          <select
            value={fromLocationId}
            onChange={(e) => {
              setFrom(e.target.value);
            }}
            className={INPUT}
          >
            <option value="">Select source...</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.code})
              </option>
            ))}
          </select>
        </Field>
        {fromLocationId && (
          <p className="text-sm text-gray-500">
            Available:{" "}
            <span className="font-semibold text-gray-900">
              {num(available)}
            </span>
          </p>
        )}
        <Field label="To">
          <select
            value={toLocationId}
            onChange={(e) => {
              setTo(e.target.value);
            }}
            className={INPUT}
          >
            <option value="">Select destination...</option>
            {locations
              .filter((l) => l.id !== fromLocationId)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.code})
                </option>
              ))}
          </select>
        </Field>
        <Field label="Quantity">
          <NumberInput
            step="any"
            value={quantity}
            onChange={(n) => {
              setQuantity(n ?? 0);
            }}
            className={INPUT}
          />
        </Field>
        <Field label="Notes">
          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
            rows={2}
            className={clsx(INPUT, "resize-none")}
          />
        </Field>
        <div className="flex justify-end gap-3">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            Transfer
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Item create/edit modal ──────────────────────────────────────────────────

function ItemFormModal({
  item,
  pending,
  onClose,
  onSubmit,
}: {
  item: Partial<InventoryItem> | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (p: Partial<InventoryItem> & { id?: string }) => Promise<void>;
}) {
  const editing = !!item?.id;
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("each");
  const [reorderPoint, setReorderPoint] = useState(0);
  const [reorderQuantity, setReorderQuantity] = useState(0);
  const [isSerialized, setIsSerialized] = useState(false);

  // Sync fields whenever a new item is opened.
  const [loadedId, setLoadedId] = useState<string | undefined>(undefined);
  if (item && loadedId !== (item.id ?? "new")) {
    setLoadedId(item.id ?? "new");
    setSku(item.sku ?? "");
    setName(item.name ?? "");
    setUnit(item.unit ?? "each");
    setReorderPoint(num(item.reorderPoint));
    setReorderQuantity(num(item.reorderQuantity));
    setIsSerialized(item.isSerialized ?? false);
  }

  if (!item) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={editing ? `Edit item: ${item.name ?? ""}` : "New inventory item"}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit({
            ...(editing ? { id: item.id } : {}),
            sku,
            name,
            unit,
            reorderPoint,
            reorderQuantity,
            isSerialized,
          });
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="SKU">
            <input
              value={sku}
              onChange={(e) => {
                setSku(e.target.value);
              }}
              required
              className={INPUT}
            />
          </Field>
          <Field label="Unit">
            <input
              value={unit}
              onChange={(e) => {
                setUnit(e.target.value);
              }}
              className={INPUT}
            />
          </Field>
        </div>
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            required
            className={INPUT}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reorder point">
            <NumberInput
              step="any"
              value={reorderPoint}
              onChange={(n) => {
                setReorderPoint(n ?? 0);
              }}
              className={INPUT}
            />
          </Field>
          <Field label="Reorder qty">
            <NumberInput
              step="any"
              value={reorderQuantity}
              onChange={(n) => {
                setReorderQuantity(n ?? 0);
              }}
              className={INPUT}
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={isSerialized}
            onChange={(e) => {
              setIsSerialized(e.target.checked);
            }}
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          Track individual serial numbers
        </label>
        {!editing && (
          <p className="text-xs text-gray-400">
            Average cost is set automatically when goods are received against a
            purchase order.
          </p>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={pending}>
            {editing ? "Save" : "Create"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Small shared bits ───────────────────────────────────────────────────────

const INPUT =
  "w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
      </label>
      {children}
    </div>
  );
}
