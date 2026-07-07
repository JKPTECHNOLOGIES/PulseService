import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeftIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import { TableSkeleton } from "../components/ui/Skeleton";
import {
  useStockLocations,
  useInventoryItems,
  useCycleCount,
  type CycleCountResult,
} from "../hooks/useInventory";

const num = (v: unknown) => Number(v ?? 0);
const INPUT =
  "w-24 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white";

/**
 * Guided cycle count: pick a location, walk the item list entering physical
 * counts, review, then apply. Variances post `count` movements; matched counts
 * still stamp the last-counted date.
 */
export default function CycleCountPage() {
  const navigate = useNavigate();
  const { data: locations, isLoading: locationsLoading } = useStockLocations({
    active: "true",
  });
  const [locationId, setLocationId] = useState("");
  const { data: items, isLoading: itemsLoading } = useInventoryItems(
    locationId ? { locationId } : {},
  );
  const cycleCount = useCycleCount();

  // counted values keyed by item id ("" = not counted yet / skipped)
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CycleCountResult | null>(null);

  const rows = locationId
    ? (items ?? []).map((item) => {
        const stockRow = item.stock?.find(
          (s) => s.stockLocationId === locationId,
        );
        return {
          item,
          expected: num(stockRow?.quantityOnHand),
          lastCount: stockRow?.lastCountDate,
        };
      })
    : [];

  const enteredCount = Object.values(counts).filter((v) => v !== "").length;

  const submit = () => {
    const payload = Object.entries(counts)
      .filter(([, v]) => v !== "")
      .map(([inventoryItemId, v]) => ({
        inventoryItemId,
        countedQuantity: Number(v),
      }));
    if (payload.length === 0) return;
    void cycleCount
      .mutateAsync({ stockLocationId: locationId, counts: payload })
      .then((r) => {
        setResult(r);
        setCounts({});
      });
  };

  if (locationsLoading) return <TableSkeleton rows={5} />;

  return (
    <div className="space-y-5 max-w-4xl">
      <div>
        <Link
          to="/inventory"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeftIcon className="h-4 w-4" /> Inventory
        </Link>
        <h2 className="text-lg font-bold text-gray-900 mt-1">Cycle Count</h2>
        <p className="text-sm text-gray-500">
          Count what is physically on the shelf or truck; variances are posted
          automatically.
        </p>
      </div>

      {/* Step 1: pick a location */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          1. Location to count
        </label>
        <select
          value={locationId}
          onChange={(e) => {
            setLocationId(e.target.value);
            setCounts({});
            setResult(null);
          }}
          className="w-full max-w-sm px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
        >
          <option value="">Select location...</option>
          {(locations ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.code})
            </option>
          ))}
        </select>
      </div>

      {/* Step 2: enter counts */}
      {locationId && !result && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">
              2. Enter physical counts{" "}
              <span className="text-gray-400 font-normal">
                (leave blank to skip an item)
              </span>
            </p>
            <span className="text-xs text-gray-500">
              {enteredCount} of {rows.length} counted
            </span>
          </div>
          {itemsLoading ? (
            <TableSkeleton rows={5} />
          ) : rows.length === 0 ? (
            <EmptyState
              title="Nothing stocked here"
              description="This location has no stocked items to count."
            />
          ) : (
            <table className="hidden md:table w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="py-2.5 px-4 font-medium">Item</th>
                  <th className="py-2.5 px-4 font-medium text-right">
                    Expected
                  </th>
                  <th className="py-2.5 px-4 font-medium text-right">
                    Counted
                  </th>
                  <th className="py-2.5 px-4 font-medium text-right">
                    Variance
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(({ item, expected }) => {
                  const value = counts[item.id] ?? "";
                  const variance =
                    value === "" ? null : Number(value) - expected;
                  return (
                    <tr key={item.id}>
                      <td className="py-2.5 px-4">
                        <span className="font-medium text-gray-900">
                          {item.name}
                        </span>
                        <span className="font-mono text-xs text-gray-400 ml-2">
                          {item.sku}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right text-gray-600">
                        {expected}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={value}
                          onChange={(e) => {
                            setCounts((c) => ({
                              ...c,
                              [item.id]: e.target.value,
                            }));
                          }}
                          className={INPUT}
                        />
                      </td>
                      <td
                        className={clsx(
                          "py-2.5 px-4 text-right font-medium",
                          variance === null || variance === 0
                            ? "text-gray-400"
                            : variance > 0
                              ? "text-green-700"
                              : "text-red-600",
                        )}
                      >
                        {variance === null
                          ? "—"
                          : `${variance > 0 ? "+" : ""}${String(variance)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!itemsLoading && rows.length > 0 && (
            <div className="md:hidden divide-y divide-gray-50">
              {rows.map(({ item, expected }) => {
                const value = counts[item.id] ?? "";
                const variance = value === "" ? null : Number(value) - expected;
                return (
                  <div key={item.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">
                          {item.name}
                        </p>
                        <p className="font-mono text-xs text-gray-400">
                          {item.sku}
                        </p>
                      </div>
                      <span
                        className={clsx(
                          "text-sm font-medium shrink-0",
                          variance === null || variance === 0
                            ? "text-gray-400"
                            : variance > 0
                              ? "text-green-700"
                              : "text-red-600",
                        )}
                      >
                        {variance === null
                          ? "—"
                          : `${variance > 0 ? "+" : ""}${String(variance)}`}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <span className="text-xs text-gray-500">
                        Expected{" "}
                        <span className="font-medium text-gray-700">
                          {expected}
                        </span>
                      </span>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={value}
                        onChange={(e) => {
                          setCounts((c) => ({
                            ...c,
                            [item.id]: e.target.value,
                          }));
                        }}
                        placeholder="Count"
                        className="ml-auto w-28 px-3 py-2 border border-gray-300 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
            <Button
              loading={cycleCount.isPending}
              disabled={enteredCount === 0}
              onClick={submit}
            >
              Apply count ({enteredCount})
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: results */}
      {result && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 space-y-4">
          <div className="flex items-center gap-2 text-green-700">
            <CheckCircleIcon className="h-5 w-5" />
            <p className="font-medium">
              Count applied — {result.counted} item(s), {result.variances}{" "}
              variance(s) posted.
            </p>
          </div>
          {result.variances > 0 && (
            <table className="hidden md:table w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                  <th className="py-2 font-medium">Item</th>
                  <th className="py-2 font-medium text-right">Expected</th>
                  <th className="py-2 font-medium text-right">Counted</th>
                  <th className="py-2 font-medium text-right">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {result.results
                  .filter((r) => r.variance !== 0)
                  .map((r) => {
                    const item = (items ?? []).find(
                      (i) => i.id === r.inventoryItemId,
                    );
                    return (
                      <tr key={r.inventoryItemId}>
                        <td className="py-2 text-gray-700">
                          {item?.name ?? r.inventoryItemId}
                        </td>
                        <td className="py-2 text-right text-gray-600">
                          {r.expected}
                        </td>
                        <td className="py-2 text-right text-gray-600">
                          {r.counted}
                        </td>
                        <td
                          className={clsx(
                            "py-2 text-right font-medium",
                            r.variance > 0 ? "text-green-700" : "text-red-600",
                          )}
                        >
                          {r.variance > 0 ? "+" : ""}
                          {r.variance}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
          {result.variances > 0 && (
            <div className="md:hidden divide-y divide-gray-50">
              {result.results
                .filter((r) => r.variance !== 0)
                .map((r) => {
                  const item = (items ?? []).find(
                    (i) => i.id === r.inventoryItemId,
                  );
                  return (
                    <div
                      key={r.inventoryItemId}
                      className="py-2 flex items-center justify-between gap-3"
                    >
                      <span className="text-gray-700 min-w-0 truncate">
                        {item?.name ?? r.inventoryItemId}
                      </span>
                      <span className="text-xs text-gray-500 shrink-0">
                        {r.expected} → {r.counted}{" "}
                        <span
                          className={clsx(
                            "font-medium",
                            r.variance > 0 ? "text-green-700" : "text-red-600",
                          )}
                        >
                          ({r.variance > 0 ? "+" : ""}
                          {r.variance})
                        </span>
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setResult(null);
              }}
            >
              Count another batch
            </Button>
            <Button
              onClick={() => {
                navigate("/inventory");
              }}
            >
              Back to inventory
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
