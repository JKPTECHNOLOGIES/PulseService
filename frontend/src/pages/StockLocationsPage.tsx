import { useState } from "react";
import { Link } from "react-router-dom";
import {
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  ArrowLeftIcon,
  ArrowDownTrayIcon,
} from "@heroicons/react/24/outline";
import Button from "../components/ui/Button";
import IconButton from "../components/ui/IconButton";
import Modal from "../components/ui/Modal";
import EmptyState from "../components/ui/EmptyState";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { StatusBadge } from "../components/ui/Badge";
import { TableSkeleton } from "../components/ui/Skeleton";
import { Can } from "../components/ui/Can";
import { usePermissions } from "../hooks/usePermissions";
import DataTable, { Column, SortState } from "../components/ui/DataTable";
import { downloadCsv } from "../utils/csv";
import {
  useStockLocations,
  useSaveStockLocation,
  useDeleteStockLocation,
  useVehicles,
} from "../hooks/useInventory";
import type { StockLocation } from "../types";

const INPUT =
  "w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white";

const csvColumns = [
  { header: "Name", value: (l: StockLocation) => l.name },
  { header: "Code", value: (l: StockLocation) => l.code },
  { header: "Type", value: (l: StockLocation) => l.type },
  {
    header: "Vehicle",
    value: (l: StockLocation) => l.vehicle?.name ?? "",
  },
  {
    header: "Stocked items",
    value: (l: StockLocation) => l._count?.stock ?? 0,
  },
  {
    header: "Status",
    value: (l: StockLocation) => (l.isActive ? "Active" : "Inactive"),
  },
];

export default function StockLocationsPage() {
  const { data: locations, isLoading } = useStockLocations();
  const del = useDeleteStockLocation();
  const { can } = usePermissions();
  const [form, setForm] = useState<Partial<StockLocation> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StockLocation | null>(
    null,
  );
  const [bulkDeactivate, setBulkDeactivate] = useState<StockLocation[]>([]);
  const [sort, setSort] = useState<SortState | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  if (isLoading) return <TableSkeleton rows={5} />;

  const columns: Column<StockLocation>[] = [
    {
      key: "name",
      header: "Name",
      sortValue: (l) => l.name.toLowerCase(),
      exportValue: (l) => l.name,
      render: (l) => (
        <span className="font-medium text-gray-900">
          {l.name}
          {l.isDefault && (
            <span className="ml-2 text-[10px] uppercase tracking-wide bg-primary-50 text-primary-700 rounded px-1.5 py-0.5">
              Default
            </span>
          )}
        </span>
      ),
    },
    {
      key: "code",
      header: "Code",
      sortValue: (l) => l.code,
      exportValue: (l) => l.code,
      render: (l) => (
        <span className="font-mono text-xs text-gray-600">{l.code}</span>
      ),
    },
    {
      key: "type",
      header: "Type",
      sortValue: (l) => l.type,
      exportValue: (l) => l.type,
      render: (l) => (
        <StatusBadge status={l.type} category="stockLocationType" />
      ),
    },
    {
      key: "vehicle",
      header: "Vehicle",
      sortValue: (l) => l.vehicle?.name.toLowerCase() ?? "",
      exportValue: (l) => l.vehicle?.name ?? "",
      render: (l) => (
        <span className="text-gray-500 text-xs">
          {l.vehicle
            ? `${l.vehicle.name}${l.vehicle.licensePlate ? ` (${l.vehicle.licensePlate})` : ""}`
            : "-"}
        </span>
      ),
    },
    {
      key: "stocked",
      header: "Stocked items",
      align: "right",
      sortValue: (l) => l._count?.stock ?? 0,
      exportValue: (l) => l._count?.stock ?? 0,
      render: (l) => (
        <span className="text-gray-600">{l._count?.stock ?? 0}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortValue: (l) => (l.isActive ? 1 : 0),
      exportValue: (l) => (l.isActive ? "Active" : "Inactive"),
      render: (l) => (
        <span
          className={
            l.isActive
              ? "text-green-700 text-xs font-medium"
              : "text-gray-400 text-xs"
          }
        >
          {l.isActive ? "Active" : "Inactive"}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <Link
            to="/inventory"
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeftIcon className="h-4 w-4" /> Inventory
          </Link>
          <h2 className="text-lg font-bold text-gray-900 mt-1">
            Stock Locations
          </h2>
          <p className="text-sm text-gray-500">
            The warehouse and every truck that carries stock.
          </p>
        </div>
        <Can permission="inventory.manage">
          <Button
            size="sm"
            icon={<PlusIcon className="h-4 w-4" />}
            onClick={() => {
              setForm({});
            }}
          >
            New Location
          </Button>
        </Can>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {!locations || locations.length === 0 ? (
          <EmptyState
            title="No stock locations"
            description="Create the main warehouse and one location per truck."
          />
        ) : (
          <DataTable<StockLocation>
            columns={columns}
            rows={locations}
            getRowId={(l) => l.id}
            sort={sort}
            onSortChange={setSort}
            selectable
            selectedIds={selectedIds}
            onSelectionChange={setSelectedIds}
            csvFilename="stock-locations"
            renderMobileCard={(l) => (
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-gray-900">
                    {l.name}
                    {l.isDefault && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide bg-primary-50 text-primary-700 rounded px-1.5 py-0.5">
                        Default
                      </span>
                    )}
                  </span>
                  <StatusBadge status={l.type} category="stockLocationType" />
                </div>
                <p className="font-mono text-xs text-gray-500 mt-0.5">
                  {l.code}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {l.vehicle
                    ? `${l.vehicle.name}${l.vehicle.licensePlate ? ` (${l.vehicle.licensePlate})` : ""}`
                    : "-"}
                  {" \u00b7 "}
                  {l._count?.stock ?? 0} stocked items
                </p>
                <span
                  className={
                    l.isActive
                      ? "text-green-700 text-xs font-medium"
                      : "text-gray-400 text-xs"
                  }
                >
                  {l.isActive ? "Active" : "Inactive"}
                </span>
              </div>
            )}
            bulkActions={(rows) => {
              const eligible = rows.filter((l) => !l.isDefault && l.isActive);
              return (
                <>
                  <button
                    onClick={() => {
                      downloadCsv("stock-locations-selected", rows, csvColumns);
                    }}
                    className="flex items-center gap-1.5 text-sm font-medium text-primary-600 hover:text-primary-800"
                  >
                    <ArrowDownTrayIcon className="h-4 w-4" />
                    Export selected
                  </button>
                  {can("inventory.manage") && eligible.length > 0 && (
                    <button
                      onClick={() => {
                        setBulkDeactivate(eligible);
                      }}
                      className="flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-800"
                    >
                      <TrashIcon className="h-4 w-4" />
                      Deactivate selected ({eligible.length})
                    </button>
                  )}
                </>
              );
            }}
            rowActions={(loc) => (
              <Can permission="inventory.manage">
                <IconButton
                  label="Edit"
                  onClick={() => {
                    setForm(loc);
                  }}
                >
                  <PencilSquareIcon className="h-4 w-4" />
                </IconButton>
                {!loc.isDefault && loc.isActive && (
                  <IconButton
                    label="Deactivate"
                    onClick={() => {
                      setConfirmDelete(loc);
                    }}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </IconButton>
                )}
              </Can>
            )}
          />
        )}
      </div>

      <LocationFormModal
        location={form}
        onClose={() => {
          setForm(null);
        }}
      />

      <ConfirmDialog
        isOpen={!!confirmDelete}
        title="Deactivate location?"
        message={`"${confirmDelete?.name ?? ""}" will no longer be selectable for receiving or transfers. Stock history is kept.`}
        confirmLabel="Deactivate"
        onClose={() => {
          setConfirmDelete(null);
        }}
        onConfirm={() => {
          if (confirmDelete) void del.mutateAsync(confirmDelete.id);
          setConfirmDelete(null);
        }}
      />

      <ConfirmDialog
        isOpen={bulkDeactivate.length > 0}
        title="Deactivate locations?"
        message={`${String(bulkDeactivate.length)} location${bulkDeactivate.length === 1 ? "" : "s"} will no longer be selectable for receiving or transfers. Stock history is kept.`}
        confirmLabel="Deactivate"
        onClose={() => {
          setBulkDeactivate([]);
        }}
        onConfirm={() => {
          for (const loc of bulkDeactivate) void del.mutateAsync(loc.id);
          setBulkDeactivate([]);
          setSelectedIds([]);
        }}
      />
    </div>
  );
}

function LocationFormModal({
  location,
  onClose,
}: {
  location: Partial<StockLocation> | null;
  onClose: () => void;
}) {
  const save = useSaveStockLocation();
  const { data: vehicles } = useVehicles();
  const editing = !!location?.id;

  const [loadedId, setLoadedId] = useState<string | undefined>(undefined);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [type, setType] = useState("warehouse");
  const [vehicleId, setVehicleId] = useState("");
  const [address, setAddress] = useState("");

  if (location && loadedId !== (location.id ?? "new")) {
    setLoadedId(location.id ?? "new");
    setName(location.name ?? "");
    setCode(location.code ?? "");
    setType(location.type ?? "warehouse");
    setVehicleId(location.vehicleId ?? "");
    setAddress(location.address ?? "");
  }

  if (!location) return null;

  const vehicleOptions = (vehicles ?? []).filter(
    (v) => !v.stockLocation || v.stockLocation.id === location.id,
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={editing ? `Edit: ${location.name ?? ""}` : "New stock location"}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save
            .mutateAsync({
              ...(editing ? { id: location.id } : {}),
              name,
              code,
              type,
              vehicleId: type === "truck" && vehicleId ? vehicleId : undefined,
              address: address || undefined,
            })
            .then(() => {
              onClose();
            });
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-3">
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
          <Field label="Code">
            <input
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase());
              }}
              required
              placeholder="e.g. TRK103"
              className={INPUT}
            />
          </Field>
        </div>
        <Field label="Type">
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value);
            }}
            className={INPUT}
          >
            <option value="warehouse">Warehouse</option>
            <option value="truck">Truck</option>
          </select>
        </Field>
        {type === "truck" && (
          <Field label="Vehicle">
            <select
              value={vehicleId}
              onChange={(e) => {
                setVehicleId(e.target.value);
              }}
              className={INPUT}
            >
              <option value="">(none)</option>
              {vehicleOptions.map((v) => {
                const tech = v.technicians?.[0]?.user;
                return (
                  <option key={v.id} value={v.id}>
                    {v.name}
                    {v.licensePlate ? ` · ${v.licensePlate}` : ""}
                    {tech ? ` — ${tech.firstName} ${tech.lastName}` : ""}
                  </option>
                );
              })}
            </select>
          </Field>
        )}
        {type === "warehouse" && (
          <Field label="Address">
            <input
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
              }}
              className={INPUT}
            />
          </Field>
        )}
        <div className="flex justify-end gap-3">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending}>
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
