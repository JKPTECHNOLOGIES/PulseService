import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  PlusIcon,
  TrashIcon,
  ExclamationTriangleIcon,
  ArrowDownTrayIcon,
} from "@heroicons/react/24/outline";
import Button from "../components/ui/Button";
import Modal from "../components/ui/Modal";
import EmptyState from "../components/ui/EmptyState";
import { NumberInput } from "../components/ui/NumberInput";
import { StatusBadge } from "../components/ui/Badge";
import { TableSkeleton } from "../components/ui/Skeleton";
import { Can } from "../components/ui/Can";
import { LookupSelect } from "../components/ui/LookupSelect";
import DataTable, { Column, SortState } from "../components/ui/DataTable";
import { downloadCsv } from "../utils/csv";
import { formatCurrency, formatDate } from "../utils/formatters";
import { generateId } from "../utils/id";
import {
  usePurchaseOrders,
  useCreatePurchaseOrder,
  useReorderSuggestions,
  type POLineInput,
} from "../hooks/usePurchasing";
import { useSuppliers } from "../hooks/useSuppliers";
import { useStockLocations, useInventoryItems } from "../hooks/useInventory";
import type { PurchaseOrder } from "../types";

const INPUT =
  "w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white";

// Decimal fields arrive from the API as strings; coerce defensively.
const num = (v: unknown) => Number(v ?? 0);

const csvColumns = [
  { header: "PO #", value: (po: PurchaseOrder) => po.poNumber },
  { header: "Supplier", value: (po: PurchaseOrder) => po.supplier?.name ?? "" },
  { header: "Status", value: (po: PurchaseOrder) => po.status },
  {
    header: "Ship To",
    value: (po: PurchaseOrder) => po.shipToLocation?.code ?? "",
  },
  { header: "Ordered", value: (po: PurchaseOrder) => formatDate(po.orderDate) },
  { header: "Total", value: (po: PurchaseOrder) => num(po.totalAmount) },
];

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState("");
  const { data, isLoading } = usePurchaseOrders(
    statusFilter ? { status: statusFilter } : {},
  );
  const [creating, setCreating] = useState(false);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const orders = data?.data ?? [];

  const columns: Column<PurchaseOrder>[] = [
    {
      key: "poNumber",
      header: "PO #",
      sortValue: (po) => po.poNumber,
      exportValue: (po) => po.poNumber,
      render: (po) => (
        <span className="font-mono text-xs text-gray-700">{po.poNumber}</span>
      ),
    },
    {
      key: "supplier",
      header: "Supplier",
      sortValue: (po) => po.supplier?.name.toLowerCase() ?? "",
      exportValue: (po) => po.supplier?.name ?? "",
      render: (po) => (
        <span className="font-medium text-gray-900">
          {po.supplier?.name ?? "-"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (po) => po.status,
      exportValue: (po) => po.status,
      render: (po) => <StatusBadge status={po.status} category="poStatus" />,
    },
    {
      key: "shipTo",
      header: "Ship To",
      sortValue: (po) => po.shipToLocation?.code.toLowerCase() ?? "",
      exportValue: (po) => po.shipToLocation?.code ?? "",
      render: (po) => (
        <span className="text-gray-500 text-xs">
          {po.shipToLocation?.code ?? "-"}
        </span>
      ),
    },
    {
      key: "ordered",
      header: "Ordered",
      sortValue: (po) => new Date(po.orderDate).getTime(),
      exportValue: (po) => formatDate(po.orderDate),
      render: (po) => (
        <span className="text-gray-500 text-xs">
          {formatDate(po.orderDate)}
        </span>
      ),
    },
    {
      key: "total",
      header: "Total",
      align: "right",
      sortValue: (po) => num(po.totalAmount),
      exportValue: (po) => num(po.totalAmount),
      render: (po) => (
        <span className="text-gray-700">
          {formatCurrency(num(po.totalAmount))}
        </span>
      ),
    },
  ];

  if (isLoading) return <TableSkeleton rows={6} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <LookupSelect
            category="poStatus"
            placeholder="All statuses"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
            }}
            className="w-48"
          />
          <p className="text-sm text-gray-500">
            {data?.pagination.total ?? 0} orders
          </p>
        </div>
        <Can permission="purchasing.manage">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              icon={<ExclamationTriangleIcon className="h-4 w-4" />}
              onClick={() => {
                setReorderOpen(true);
              }}
            >
              Reorder Suggestions
            </Button>
            <Button
              size="sm"
              icon={<PlusIcon className="h-4 w-4" />}
              onClick={() => {
                setCreating(true);
              }}
            >
              New PO
            </Button>
          </div>
        </Can>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {orders.length === 0 ? (
          <EmptyState
            title="No purchase orders"
            description="Create a PO to order parts and equipment from a supplier."
          />
        ) : (
          <DataTable<PurchaseOrder>
            columns={columns}
            rows={orders}
            getRowId={(po) => po.id}
            onRowClick={(po) => {
              navigate(`/purchasing/${po.id}`);
            }}
            sort={sort}
            onSortChange={setSort}
            selectable
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            csvFilename="purchase-orders"
            renderMobileCard={(po) => (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-gray-700">
                    {po.poNumber}
                  </span>
                  <StatusBadge status={po.status} category="poStatus" />
                </div>
                <p className="font-medium text-gray-900 mt-0.5">
                  {po.supplier?.name ?? "-"}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {po.shipToLocation?.code ?? "-"} · {formatDate(po.orderDate)}
                </p>
                <p className="text-sm text-gray-900 font-medium mt-0.5">
                  {formatCurrency(num(po.totalAmount))}
                </p>
              </div>
            )}
            bulkActions={(rows) => (
              <button
                onClick={() => {
                  downloadCsv("purchase-orders-selected", rows, csvColumns);
                }}
                className="flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-800"
              >
                <ArrowDownTrayIcon className="h-4 w-4" />
                Export selected
              </button>
            )}
          />
        )}
      </div>

      <CreatePOModal
        open={creating}
        onClose={() => {
          setCreating(false);
        }}
      />
      <ReorderSuggestionsModal
        open={reorderOpen}
        onClose={() => {
          setReorderOpen(false);
        }}
      />
    </div>
  );
}

function ReorderSuggestionsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { data: groups, isLoading } = useReorderSuggestions(open);
  const create = useCreatePurchaseOrder();
  const { data: locations } = useStockLocations({ active: "true" });
  const [creatingFor, setCreatingFor] = useState<string | null>(null);

  if (!open) return null;

  const defaultWarehouse = (locations ?? []).find((l) => l.isDefault);

  const createDraft = (group: NonNullable<typeof groups>[number]) => {
    if (!group.supplier.id) return;
    setCreatingFor(group.supplier.id);
    void create
      .mutateAsync({
        supplierId: group.supplier.id,
        shipToLocationId: defaultWarehouse?.id,
        lines: group.lines.map((l) => ({
          inventoryItemId: l.inventoryItemId,
          lineType: "inventory",
          description: l.name,
          quantity: l.suggestedQuantity,
          unitPrice: l.unitCost,
        })),
      })
      .then((res) => {
        onClose();
        navigate(`/purchasing/${res.data.id}`);
      })
      .finally(() => {
        setCreatingFor(null);
      });
  };

  return (
    <Modal isOpen onClose={onClose} title="Reorder suggestions" size="xl">
      {isLoading ? (
        <p className="text-sm text-gray-400 py-6 text-center">
          Checking stock…
        </p>
      ) : !groups || groups.length === 0 ? (
        <p className="text-sm text-gray-500 py-6 text-center">
          Nothing is at or below its reorder point.
        </p>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div
              key={group.supplier.id ?? "unassigned"}
              className="border border-gray-100 rounded-lg overflow-hidden"
            >
              <div className="bg-gray-50 px-4 py-2.5 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-800">
                  {group.supplier.name}
                </span>
                {group.supplier.id ? (
                  <Button
                    size="sm"
                    loading={creatingFor === group.supplier.id}
                    onClick={() => {
                      createDraft(group);
                    }}
                  >
                    Create draft PO
                  </Button>
                ) : (
                  <span className="text-xs text-gray-400">
                    Assign a supplier to these items to order
                  </span>
                )}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                    <th className="py-2 px-4 font-medium">Item</th>
                    <th className="py-2 px-4 font-medium text-right">
                      On hand
                    </th>
                    <th className="py-2 px-4 font-medium text-right">
                      Reorder pt
                    </th>
                    <th className="py-2 px-4 font-medium text-right">
                      Suggested
                    </th>
                    <th className="py-2 px-4 font-medium text-right">
                      Est. cost
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {group.lines.map((l) => (
                    <tr key={l.inventoryItemId}>
                      <td className="py-2 px-4">
                        <span className="font-medium text-gray-900">
                          {l.name}
                        </span>
                        <span className="font-mono text-xs text-gray-400 ml-2">
                          {l.sku}
                        </span>
                      </td>
                      <td className="py-2 px-4 text-right text-yellow-700 font-medium">
                        {l.onHand}
                      </td>
                      <td className="py-2 px-4 text-right text-gray-500">
                        {l.reorderPoint}
                      </td>
                      <td className="py-2 px-4 text-right font-medium text-gray-900">
                        {l.suggestedQuantity}
                      </td>
                      <td className="py-2 px-4 text-right text-gray-600">
                        {formatCurrency(l.suggestedQuantity * l.unitCost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

interface DraftLine extends POLineInput {
  key: string;
}

function CreatePOModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const create = useCreatePurchaseOrder();
  const { data: suppliers } = useSuppliers({ active: "true" });
  const { data: locations } = useStockLocations({ active: "true" });
  const { data: items } = useInventoryItems();

  const [supplierId, setSupplierId] = useState("");
  const [shipToLocationId, setShipTo] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);

  const reset = () => {
    setSupplierId("");
    setShipTo("");
    setExpectedDate("");
    setLines([]);
  };

  const addLine = () => {
    setLines((ls) => [
      ...ls,
      {
        key: generateId(),
        lineType: "inventory",
        description: "",
        quantity: 1,
        unitPrice: 0,
      },
    ]);
  };

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: string) => {
    setLines((ls) => ls.filter((l) => l.key !== key));
  };

  const onPickItem = (key: string, itemId: string) => {
    const item = (items ?? []).find((i) => i.id === itemId);
    updateLine(key, {
      inventoryItemId: itemId || undefined,
      description: item ? item.name : "",
      unitPrice: item ? num(item.unitCost) : 0,
    });
  };

  const total = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);

  return (
    <Modal
      isOpen={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title="New purchase order"
      size="xl"
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Supplier">
            <select
              value={supplierId}
              onChange={(e) => {
                setSupplierId(e.target.value);
              }}
              className={INPUT}
            >
              <option value="">Select supplier...</option>
              {(suppliers ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ship to">
            <select
              value={shipToLocationId}
              onChange={(e) => {
                setShipTo(e.target.value);
              }}
              className={INPUT}
            >
              <option value="">Select location...</option>
              {(locations ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.code})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Expected date">
            <input
              type="date"
              value={expectedDate}
              onChange={(e) => {
                setExpectedDate(e.target.value);
              }}
              className={INPUT}
            />
          </Field>
        </div>

        {/* Lines */}
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">
              Line items
            </span>
            <Button size="sm" variant="outline" onClick={addLine}>
              Add line
            </Button>
          </div>
          {lines.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">
              No lines yet
            </p>
          ) : (
            <div className="divide-y divide-gray-100">
              {lines.map((l) => (
                <div
                  key={l.key}
                  className="p-3 grid grid-cols-12 gap-2 items-end"
                >
                  <div className="col-span-5">
                    <label className="block text-xs text-gray-500 mb-1">
                      Item
                    </label>
                    <select
                      value={l.inventoryItemId ?? ""}
                      onChange={(e) => {
                        onPickItem(l.key, e.target.value);
                      }}
                      className={INPUT}
                    >
                      <option value="">Custom / non-stock...</option>
                      {(items ?? []).map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.sku} — {i.name}
                        </option>
                      ))}
                    </select>
                    {!l.inventoryItemId && (
                      <input
                        value={l.description}
                        onChange={(e) => {
                          updateLine(l.key, {
                            description: e.target.value,
                            lineType: "non_stock",
                          });
                        }}
                        placeholder="Description"
                        className={`${INPUT} mt-2`}
                      />
                    )}
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">
                      Qty
                    </label>
                    <NumberInput
                      step="any"
                      value={l.quantity}
                      onChange={(n) => {
                        updateLine(l.key, { quantity: n ?? 0 });
                      }}
                      className={INPUT}
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">
                      Unit price
                    </label>
                    <NumberInput
                      step="any"
                      value={l.unitPrice}
                      onChange={(n) => {
                        updateLine(l.key, {
                          unitPrice: n ?? 0,
                        });
                      }}
                      className={INPUT}
                    />
                  </div>
                  <div className="col-span-2 text-right text-sm text-gray-700 pb-2.5">
                    {formatCurrency(l.quantity * l.unitPrice)}
                  </div>
                  <div className="col-span-1 flex justify-end pb-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        removeLine(l.key);
                      }}
                      className="p-1.5 text-gray-400 hover:text-red-500"
                      aria-label="Remove line"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">
            Subtotal:{" "}
            <span className="font-semibold text-gray-900">
              {formatCurrency(total)}
            </span>
          </span>
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button
              loading={create.isPending}
              disabled={!supplierId || lines.length === 0}
              onClick={() => {
                void (async () => {
                  const res = await create.mutateAsync({
                    supplierId,
                    shipToLocationId: shipToLocationId || undefined,
                    expectedDate: expectedDate || undefined,
                    lines: lines.map((l) => ({
                      inventoryItemId: l.inventoryItemId,
                      lineType: l.lineType,
                      description: l.description,
                      quantity: l.quantity,
                      unitPrice: l.unitPrice,
                      notes: l.notes,
                    })),
                  });
                  reset();
                  onClose();
                  navigate(`/purchasing/${res.data.id}`);
                })();
              }}
            >
              Create PO
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

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
