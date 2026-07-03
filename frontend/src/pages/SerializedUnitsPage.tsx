import { useState } from "react";
import EmptyState from "../components/ui/EmptyState";
import { StatusBadge } from "../components/ui/Badge";
import { TableSkeleton } from "../components/ui/Skeleton";
import { LookupSelect } from "../components/ui/LookupSelect";
import { Can } from "../components/ui/Can";
import Pagination from "../components/ui/Pagination";
import InstallSerialModal from "../components/ui/InstallSerialModal";
import Button from "../components/ui/Button";
import { formatDate } from "../utils/formatters";
import {
  useSerializedUnits,
  useUpdateSerializedUnit,
} from "../hooks/useSerials";
import { useLookup } from "../hooks/useMetadata";
import type { SerializedUnit } from "../types";

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
  const updateUnit = useUpdateSerializedUnit();
  const { options: statusOptions } = useLookup("serializedUnitStatus");
  const [installUnit, setInstallUnit] = useState<SerializedUnit | null>(null);

  const units = data?.data ?? [];

  if (isLoading) return <TableSkeleton rows={8} />;

  return (
    <div className="space-y-5">
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

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {units.length === 0 ? (
          <EmptyState
            title="No serialized units"
            description="Serialized units are created when serialized items are received against a PO."
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                <th className="py-3 px-4 font-medium">Serial #</th>
                <th className="py-3 px-4 font-medium">Item</th>
                <th className="py-3 px-4 font-medium">Status</th>
                <th className="py-3 px-4 font-medium">Location</th>
                <th className="py-3 px-4 font-medium">Warranty</th>
                <th className="py-3 px-4 font-medium">Change status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {units.map((u: SerializedUnit) => (
                <tr key={u.id}>
                  <td className="py-3 px-4 font-mono text-xs text-gray-700">
                    {u.serialNumber}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-gray-900">
                      {u.inventoryItem?.name ?? "-"}
                    </div>
                    <div className="font-mono text-xs text-gray-400">
                      {u.inventoryItem?.sku}
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <StatusBadge
                      status={u.status}
                      category="serializedUnitStatus"
                    />
                  </td>
                  <td className="py-3 px-4 text-gray-500 text-xs">
                    {u.stockLocation?.code ?? "-"}
                  </td>
                  <td className="py-3 px-4 text-gray-500 text-xs">
                    {u.warrantyExpiresAt
                      ? formatDate(u.warrantyExpiresAt)
                      : "-"}
                  </td>
                  <td className="py-3 px-4">
                    <Can
                      permission="inventory.manage"
                      fallback={
                        <span className="text-gray-300 text-xs">—</span>
                      }
                    >
                      <div className="flex items-center gap-2">
                        <select
                          value={u.status}
                          onChange={(e) => {
                            updateUnit.mutate({
                              id: u.id,
                              status: e.target.value,
                            });
                          }}
                          className="text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                        >
                          {statusOptions.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        {(u.status === "in_stock" ||
                          u.status === "reserved") && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setInstallUnit(u);
                            }}
                          >
                            Install
                          </Button>
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
    </div>
  );
}
