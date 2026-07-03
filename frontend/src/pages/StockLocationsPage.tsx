import { useState } from "react";
import { Link } from "react-router-dom";
import {
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  ArrowLeftIcon,
} from "@heroicons/react/24/outline";
import Button from "../components/ui/Button";
import IconButton from "../components/ui/IconButton";
import Modal from "../components/ui/Modal";
import EmptyState from "../components/ui/EmptyState";
import ConfirmDialog from "../components/ui/ConfirmDialog";
import { StatusBadge } from "../components/ui/Badge";
import { TableSkeleton } from "../components/ui/Skeleton";
import { Can } from "../components/ui/Can";
import {
  useStockLocations,
  useSaveStockLocation,
  useDeleteStockLocation,
  useVehicles,
} from "../hooks/useInventory";
import type { StockLocation } from "../types";

const INPUT =
  "w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white";

export default function StockLocationsPage() {
  const { data: locations, isLoading } = useStockLocations();
  const del = useDeleteStockLocation();
  const [form, setForm] = useState<Partial<StockLocation> | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<StockLocation | null>(null);

  if (isLoading) return <TableSkeleton rows={5} />;

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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="py-3 px-4 font-medium">Name</th>
                <th className="py-3 px-4 font-medium">Code</th>
                <th className="py-3 px-4 font-medium">Type</th>
                <th className="py-3 px-4 font-medium">Vehicle</th>
                <th className="py-3 px-4 font-medium text-right">Stocked items</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {locations.map((loc) => (
                <tr key={loc.id} className="hover:bg-gray-50">
                  <td className="py-3 px-4 font-medium text-gray-900">
                    {loc.name}
                    {loc.isDefault && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide bg-primary-50 text-primary-700 rounded px-1.5 py-0.5">
                        Default
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 font-mono text-xs text-gray-600">
                    {loc.code}
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge status={loc.type} category="stockLocationType" />
                  </td>
                  <td className="py-3 px-4 text-gray-500 text-xs">
                    {loc.vehicle
                      ? `${loc.vehicle.name}${loc.vehicle.licensePlate ? ` (${loc.vehicle.licensePlate})` : ""}`
                      : "-"}
                  </td>
                  <td className="py-3 px-4 text-right text-gray-600">
                    {loc._count?.stock ?? 0}
                  </td>
                  <td className="py-3 px-4">
                    <span
                      className={
                        loc.isActive
                          ? "text-green-700 text-xs font-medium"
                          : "text-gray-400 text-xs"
                      }
                    >
                      {loc.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <Can permission="inventory.manage">
                      <div className="flex justify-end gap-1">
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
                      </div>
                    </Can>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
