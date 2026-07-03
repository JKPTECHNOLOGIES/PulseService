import { useState } from "react";
import Modal from "./Modal";
import Button from "./Button";
import { useCustomers, useCustomer } from "../../hooks/useCustomers";
import {
  useInstallSerializedUnit,
  useSerializedUnits,
} from "../../hooks/useSerials";
import type { SerializedUnit } from "../../types";

const INPUT =
  "w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white";

interface Props {
  isOpen: boolean;
  /** Fixed unit to install (Serialized Units page). Omit for picker mode. */
  unit?: SerializedUnit | null;
  /** Pre-select a customer (e.g. when installing from a job). */
  defaultCustomerId?: string;
  /** Link the install to this job. */
  defaultJobId?: string;
  onClose: () => void;
}

/**
 * Marks a serialized unit as installed and links it to a customer (and,
 * optionally, one of their service locations, a job, and a warranty date).
 * When no fixed `unit` is passed it shows a picker of in-stock units.
 */
export default function InstallSerialModal({
  isOpen,
  unit,
  defaultCustomerId,
  defaultJobId,
  onClose,
}: Props) {
  const install = useInstallSerializedUnit();
  const pickMode = !unit;

  const [unitSearch, setUnitSearch] = useState("");
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState(defaultCustomerId ?? "");
  const [locationId, setLocationId] = useState("");
  const [warrantyExpiresAt, setWarranty] = useState("");

  // Reset when (re)opened.
  const [wasOpen, setWasOpen] = useState(false);
  if (isOpen && !wasOpen) {
    setWasOpen(true);
    setUnitSearch("");
    setSelectedUnitId("");
    setSearch("");
    setCustomerId(defaultCustomerId ?? "");
    setLocationId("");
    setWarranty("");
  }
  if (!isOpen && wasOpen) setWasOpen(false);

  const { data: availableUnits } = useSerializedUnits(
    pickMode
      ? {
          status: "in_stock",
          limit: 10,
          ...(unitSearch ? { search: unitSearch } : {}),
        }
      : { limit: 1 },
  );
  const { data: customerResults } = useCustomers(
    search ? { search, limit: 10 } : { limit: 10 },
  );
  const { data: selectedCustomer } = useCustomer(customerId);
  const locations = selectedCustomer?.locations ?? [];

  if (!isOpen) return null;

  const unitId = unit ? unit.id : selectedUnitId;
  const title = unit
    ? `Install ${unit.serialNumber}`
    : "Install serialized unit";

  const submit = () => {
    if (!unitId) return;
    void install
      .mutateAsync({
        id: unitId,
        installedCustomerId: customerId || undefined,
        installedLocationId: locationId || undefined,
        installedJobId: defaultJobId,
        warrantyExpiresAt: warrantyExpiresAt || undefined,
      })
      .then(() => {
        onClose();
      });
  };

  return (
    <Modal isOpen onClose={onClose} title={title} size="md">
      <div className="space-y-4">
        {unit ? (
          <p className="text-sm text-gray-500">
            {unit.inventoryItem?.name ?? "Unit"} · serial{" "}
            <span className="font-mono">{unit.serialNumber}</span>
          </p>
        ) : (
          <>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Find in-stock unit
              </label>
              <input
                value={unitSearch}
                onChange={(e) => {
                  setUnitSearch(e.target.value);
                }}
                placeholder="Search serial number..."
                className={INPUT}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Unit
              </label>
              <select
                value={selectedUnitId}
                onChange={(e) => {
                  setSelectedUnitId(e.target.value);
                }}
                className={INPUT}
              >
                <option value="">Select unit...</option>
                {(availableUnits?.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.serialNumber} — {u.inventoryItem?.name ?? ""}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {!defaultCustomerId && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Find customer
            </label>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              placeholder="Search by name..."
              className={INPUT}
            />
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Customer
          </label>
          <select
            value={customerId}
            onChange={(e) => {
              setCustomerId(e.target.value);
              setLocationId("");
            }}
            className={INPUT}
            disabled={!!defaultCustomerId}
          >
            <option value="">Select customer...</option>
            {(customerResults?.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.companyName
                  ? `${c.companyName} (${c.firstName} ${c.lastName})`
                  : `${c.firstName} ${c.lastName}`}
              </option>
            ))}
          </select>
        </div>

        {customerId && locations.length > 0 && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Service location
            </label>
            <select
              value={locationId}
              onChange={(e) => {
                setLocationId(e.target.value);
              }}
              className={INPUT}
            >
              <option value="">(none)</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.address}, {l.city}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Warranty expires (optional)
          </label>
          <input
            type="date"
            value={warrantyExpiresAt}
            onChange={(e) => {
              setWarranty(e.target.value);
            }}
            className={INPUT}
          />
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={install.isPending}
            disabled={!customerId || !unitId}
            onClick={submit}
          >
            Mark installed
          </Button>
        </div>
      </div>
    </Modal>
  );
}
