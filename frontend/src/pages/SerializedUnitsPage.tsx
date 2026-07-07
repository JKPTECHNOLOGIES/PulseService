import { useState } from "react";
import {
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  ArrowDownTrayIcon,
} from "@heroicons/react/24/outline";
import EmptyState from "../components/ui/EmptyState";
import { StatusBadge } from "../components/ui/Badge";
import { TableSkeleton } from "../components/ui/Skeleton";
import { LookupSelect } from "../components/ui/LookupSelect";
import { Can } from "../components/ui/Can";
import { usePermissions } from "../hooks/usePermissions";
import Pagination from "../components/ui/Pagination";
import InstallSerialModal from "../components/ui/InstallSerialModal";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import IconButton from "../components/ui/IconButton";
import Modal from "../components/ui/Modal";
import Button from "../components/ui/Button";
import DataTable, { Column, SortState } from "../components/ui/DataTable";
import { downloadCsv } from "../utils/csv";
import { formatDate } from "../utils/formatters";
import {
  useSerializedUnits,
  useCreateSerializedUnit,
  useUpdateSerializedUnit,
  useDeleteSerializedUnit,
} from "../hooks/useSerials";
import { useInventoryItems, useStockLocations } from "../hooks/useInventory";
import { useLookup } from "../hooks/useMetadata";
import type { SerializedUnit } from "../types";

const csvColumns = [
  { header: "Serial #", value: (u: SerializedUnit) => u.serialNumber },
  { header: "Item", value: (u: SerializedUnit) => u.inventoryItem?.name ?? "" },
  { header: "SKU", value: (u: SerializedUnit) => u.inventoryItem?.sku ?? "" },
  { header: "Status", value: (u: SerializedUnit) => u.status },
  {
    header: "Location",
    value: (u: SerializedUnit) => u.stockLocation?.code ?? "",
  },
  {
    header: "Warranty expires",
    value: (u: SerializedUnit) =>
      u.warrantyExpiresAt ? formatDate(u.warrantyExpiresAt) : "",
  },
];

const INPUT =
  "w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white";

export default function SerializedUnitsPage() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading } = useSerializedUnits({
    page,
    limit: 20,
    ...(status ? { status } : {}),
    ...(search ? { search } : {}),
  });
  const createUnit = useCreateSerializedUnit();
  const updateUnit = useUpdateSerializedUnit();
  const deleteUnit = useDeleteSerializedUnit();
  const { can } = usePermissions();
  const { options: statusOptions } = useLookup("serializedUnitStatus");
  const [installUnit, setInstallUnit] = useState<SerializedUnit | null>(null);
  const [formUnit, setFormUnit] = useState<Partial<SerializedUnit> | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState<SerializedUnit | null>(
    null,
  );
  const [bulkDelete, setBulkDelete] = useState<SerializedUnit[]>([]);
  const [sort, setSort] = useState<SortState | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const units = data?.data ?? [];

  const columns: Column<SerializedUnit>[] = [
    {
      key: "serialNumber",
      header: "Serial #",
      sortValue: (u) => u.serialNumber,
      exportValue: (u) => u.serialNumber,
      render: (u) => (
        <span className="font-mono text-xs text-gray-700">
          {u.serialNumber}
        </span>
      ),
    },
    {
      key: "item",
      header: "Item",
      sortValue: (u) => u.inventoryItem?.name.toLowerCase() ?? "",
      exportValue: (u) => u.inventoryItem?.name ?? "",
      render: (u) => (
        <div>
          <div className="font-medium text-gray-900">
            {u.inventoryItem?.name ?? "-"}
          </div>
          <div className="font-mono text-xs text-gray-400">
            {u.inventoryItem?.sku}
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (u) => u.status,
      exportValue: (u) => u.status,
      render: (u) => (
        <StatusBadge status={u.status} category="serializedUnitStatus" />
      ),
    },
    {
      key: "location",
      header: "Location",
      sortValue: (u) => u.stockLocation?.code.toLowerCase() ?? "",
      exportValue: (u) => u.stockLocation?.code ?? "",
      render: (u) => (
        <span className="text-gray-500 text-xs">
          {u.stockLocation?.code ?? "-"}
        </span>
      ),
    },
    {
      key: "warranty",
      header: "Warranty",
      sortValue: (u) =>
        u.warrantyExpiresAt ? new Date(u.warrantyExpiresAt).getTime() : 0,
      exportValue: (u) =>
        u.warrantyExpiresAt ? formatDate(u.warrantyExpiresAt) : "",
      render: (u) => (
        <span className="text-gray-500 text-xs">
          {u.warrantyExpiresAt ? formatDate(u.warrantyExpiresAt) : "-"}
        </span>
      ),
    },
    {
      key: "changeStatus",
      header: "Change status",
      render: (u) => (
        <Can
          permission={["inventory.manage", "inventory.issueToJob"]}
          fallback={<span className="text-gray-300 text-xs">—</span>}
        >
          <div className="flex items-center gap-2">
            {/* Changing status arbitrarily is a manage-only action;
                issuing a unit to a job (Install) is available to
                inventory.issueToJob too. */}
            <Can permission="inventory.manage">
              <select
                value={u.status}
                onClick={(e) => {
                  e.stopPropagation();
                }}
                onChange={(e) => {
                  updateUnit.mutate({
                    id: u.id,
                    status: e.target.value,
                  });
                }}
                className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
              >
                {/* "Installed" is set only via the dedicated Install
                  action below (it needs a customer/job link this
                  dropdown can't collect) -- keep it selectable
                  here only when it's already the unit's status,
                  so the control still displays correctly. */}
                {statusOptions
                  .filter(
                    (o) => o.value !== "installed" || u.status === "installed",
                  )
                  .map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
              </select>
            </Can>
            {(u.status === "in_stock" || u.status === "reserved") && (
              <Button
                size="sm"
                variant="outline"
                onClick={(e) => {
                  e.stopPropagation();
                  setInstallUnit(u);
                }}
              >
                Install
              </Button>
            )}
          </div>
        </Can>
      ),
    },
  ];

  if (isLoading) return <TableSkeleton rows={8} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search serial number..."
            className="px-3.5 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 w-64"
          />
          <LookupSelect
            category="serializedUnitStatus"
            placeholder="All statuses"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="w-48"
          />
          <p className="text-sm text-gray-500">
            {data?.pagination.total ?? 0} units
          </p>
        </div>
        <Can permission="inventory.manage">
          <Button
            size="sm"
            icon={<PlusIcon className="h-4 w-4" />}
            onClick={() => {
              setFormUnit({});
            }}
          >
            New Unit
          </Button>
        </Can>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {units.length === 0 ? (
          <EmptyState
            title="No serialized units"
            description="Serialized units are created when serialized items are received against a PO, or you can add one manually."
          />
        ) : (
          <DataTable<SerializedUnit>
            columns={columns}
            rows={units}
            getRowId={(u) => u.id}
            sort={sort}
            onSortChange={setSort}
            selectable
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            csvFilename="serialized-units"
            renderMobileCard={(u) => (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-gray-700">
                    {u.serialNumber}
                  </span>
                  <StatusBadge
                    status={u.status}
                    category="serializedUnitStatus"
                  />
                </div>
                <p className="font-medium text-gray-900 mt-0.5">
                  {u.inventoryItem?.name ?? "-"}
                </p>
                <p className="font-mono text-xs text-gray-400">
                  {u.inventoryItem?.sku}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {u.stockLocation?.code ?? "-"}
                  {u.warrantyExpiresAt
                    ? ` \u00b7 warranty to ${formatDate(u.warrantyExpiresAt)}`
                    : ""}
                </p>
              </div>
            )}
            bulkActions={(rows) => {
              const eligible = rows.filter((u) => u.status !== "installed");
              return (
                <>
                  <button
                    onClick={() => {
                      downloadCsv(
                        "serialized-units-selected",
                        rows,
                        csvColumns,
                      );
                    }}
                    className="flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-800"
                  >
                    <ArrowDownTrayIcon className="h-4 w-4" />
                    Export selected
                  </button>
                  {can("inventory.manage") && eligible.length > 0 && (
                    <button
                      onClick={() => {
                        setBulkDelete(eligible);
                      }}
                      className="flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-800"
                    >
                      <TrashIcon className="h-4 w-4" />
                      Delete selected ({eligible.length})
                    </button>
                  )}
                </>
              );
            }}
            rowActions={(u) => (
              <Can permission="inventory.manage">
                <IconButton
                  label="Edit"
                  onClick={() => {
                    setFormUnit(u);
                  }}
                >
                  <PencilSquareIcon className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label="Delete"
                  variant="danger"
                  onClick={() => {
                    setConfirmDelete(u);
                  }}
                >
                  <TrashIcon className="h-4 w-4" />
                </IconButton>
              </Can>
            )}
          />
        )}
      </div>

      {data && data.pagination.totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={data.pagination.totalPages}
          onPageChange={setPage}
        />
      )}

      <InstallSerialModal
        isOpen={!!installUnit}
        unit={installUnit}
        onClose={() => {
          setInstallUnit(null);
        }}
      />

      <SerializedUnitFormModal
        unit={formUnit}
        pending={createUnit.isPending || updateUnit.isPending}
        onClose={() => {
          setFormUnit(null);
        }}
        onSubmit={async (payload) => {
          if (payload.id) {
            const { id, ...rest } = payload;
            await updateUnit.mutateAsync({ id, ...rest });
          } else {
            await createUnit.mutateAsync({
              serialNumber: payload.serialNumber ?? "",
              inventoryItemId: payload.inventoryItemId ?? "",
              status: payload.status,
              stockLocationId: payload.stockLocationId,
              purchaseCost: payload.purchaseCost,
              warrantyMonths: payload.warrantyMonths,
              notes: payload.notes,
            });
          }
          setFormUnit(null);
        }}
      />

      <ConfirmDialog
        isOpen={!!confirmDelete}
        title="Delete serialized unit?"
        message={`Serial "${confirmDelete?.serialNumber ?? ""}" will be permanently removed. This can't be undone. Installed units must be uninstalled first.`}
        confirmLabel="Delete"
        loading={deleteUnit.isPending}
        onClose={() => {
          setConfirmDelete(null);
        }}
        onConfirm={() => {
          if (confirmDelete) {
            void deleteUnit.mutateAsync(confirmDelete.id).then(() => {
              setConfirmDelete(null);
            });
          }
        }}
      />

      <ConfirmDialog
        isOpen={bulkDelete.length > 0}
        title="Delete serialized units?"
        message={`${String(bulkDelete.length)} unit${bulkDelete.length === 1 ? "" : "s"} will be permanently removed. This can't be undone.`}
        confirmLabel="Delete"
        loading={deleteUnit.isPending}
        onClose={() => {
          setBulkDelete([]);
        }}
        onConfirm={() => {
          for (const u of bulkDelete) void deleteUnit.mutateAsync(u.id);
          setBulkDelete([]);
          setSelectedIds([]);
        }}
      />
    </div>
  );
}

function SerializedUnitFormModal({
  unit,
  pending,
  onClose,
  onSubmit,
}: {
  unit: Partial<SerializedUnit> | null;
  pending: boolean;
  onClose: () => void;
  onSubmit: (p: Partial<SerializedUnit> & { id?: string }) => Promise<void>;
}) {
  const editing = !!unit?.id;
  const { options: statusOptions } = useLookup("serializedUnitStatus");
  const { data: locations } = useStockLocations({ active: "true" });

  const [loadedId, setLoadedId] = useState<string | undefined>(undefined);
  const [itemSearch, setItemSearch] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [inventoryItemId, setInventoryItemId] = useState("");
  const [status, setStatus] = useState("in_stock");
  const [stockLocationId, setStockLocationId] = useState("");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [warrantyMonths, setWarrantyMonths] = useState("");
  const [notes, setNotes] = useState("");

  if (unit && loadedId !== (unit.id ?? "new")) {
    setLoadedId(unit.id ?? "new");
    setItemSearch("");
    setSerialNumber(unit.serialNumber ?? "");
    setInventoryItemId(unit.inventoryItemId ?? "");
    setStatus(unit.status ?? "in_stock");
    setStockLocationId(unit.stockLocationId ?? "");
    setPurchaseCost(
      unit.purchaseCost !== undefined ? String(unit.purchaseCost) : "",
    );
    setWarrantyMonths(
      unit.warrantyMonths !== undefined ? String(unit.warrantyMonths) : "",
    );
    setNotes(unit.notes ?? "");
  }

  // Only offer serialized items — everything else can't carry a serial number.
  const { data: itemResults } = useInventoryItems(
    itemSearch ? { search: itemSearch } : {},
  );
  const itemOptions = (itemResults ?? []).filter((i) => i.isSerialized);
  const selectedItem = unit?.inventoryItem;

  if (!unit) return null;

  const canSubmit = editing || (serialNumber.trim() && inventoryItemId);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={
        editing ? `Edit unit ${unit.serialNumber ?? ""}` : "New serialized unit"
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit({
            ...(editing ? { id: unit.id } : {}),
            serialNumber: serialNumber.trim(),
            inventoryItemId,
            status,
            stockLocationId: stockLocationId || undefined,
            purchaseCost: purchaseCost ? Number(purchaseCost) : undefined,
            warrantyMonths: warrantyMonths ? Number(warrantyMonths) : undefined,
            notes: notes.trim() || undefined,
          });
        }}
        className="space-y-4"
      >
        <Field label="Serial number">
          <input
            value={serialNumber}
            onChange={(e) => {
              setSerialNumber(e.target.value);
            }}
            required
            disabled={editing}
            className={INPUT}
          />
        </Field>

        {editing ? (
          <Field label="Item">
            <input
              value={
                selectedItem
                  ? `${selectedItem.name} (${selectedItem.sku})`
                  : "-"
              }
              disabled
              className={INPUT}
            />
          </Field>
        ) : (
          <>
            <Field label="Find item">
              <input
                value={itemSearch}
                onChange={(e) => {
                  setItemSearch(e.target.value);
                }}
                placeholder="Search serialized items..."
                className={INPUT}
              />
            </Field>
            <Field label="Item">
              <select
                value={inventoryItemId}
                onChange={(e) => {
                  setInventoryItemId(e.target.value);
                }}
                required
                className={INPUT}
              >
                <option value="">Select item...</option>
                {itemOptions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name} ({i.sku})
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Status">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
              }}
              className={INPUT}
            >
              {/* "Installed" needs a customer/job link this form doesn't
                  collect -- use the dedicated Install action instead. Kept
                  selectable here only when it's already the unit's status. */}
              {statusOptions
                .filter(
                  (o) => o.value !== "installed" || unit.status === "installed",
                )
                .map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Location">
            <select
              value={stockLocationId}
              onChange={(e) => {
                setStockLocationId(e.target.value);
              }}
              className={INPUT}
            >
              <option value="">(none)</option>
              {(locations ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.code})
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Purchase cost">
            <input
              type="number"
              step="0.01"
              min="0"
              value={purchaseCost}
              onChange={(e) => {
                setPurchaseCost(e.target.value);
              }}
              className={INPUT}
            />
          </Field>
          <Field label="Warranty (months)">
            <input
              type="number"
              min="0"
              value={warrantyMonths}
              onChange={(e) => {
                setWarrantyMonths(e.target.value);
              }}
              className={INPUT}
            />
          </Field>
        </div>

        <Field label="Notes">
          <textarea
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
            }}
            rows={2}
            className={INPUT}
          />
        </Field>

        <div className="flex justify-end gap-3">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={pending} disabled={!canSubmit}>
            {editing ? "Save" : "Create"}
          </Button>
        </div>
      </form>
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
