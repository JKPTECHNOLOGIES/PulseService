import { useState } from "react";
import { ArrowDownTrayIcon, ArrowPathIcon, TrashIcon } from "@heroicons/react/24/outline";
import Card from "../ui/Card";
import Button from "../ui/Button";
import { StatusBadge } from "../ui/Badge";
import Pagination from "../ui/Pagination";
import EmptyState from "../ui/EmptyState";
import { LookupSelect } from "../ui/LookupSelect";
import { formatDateTime } from "../../utils/formatters";
import { useLookup } from "../../hooks/useMetadata";
import { usePricebookItems } from "../../hooks/usePricebook";
import {
  useQuickBooksSettings,
  useSaveQuickBooksSettings,
  downloadQuickBooksConnectorFile,
  useQuickBooksQueue,
  useRetryQuickBooksJob,
  useResyncQuickBooksCustomers,
  useQuickBooksItemMappings,
  useSaveQuickBooksItemMapping,
  useDeleteQuickBooksItemMapping,
} from "../../hooks/useQuickBooks";

const INPUT =
  "w-full px-3.5 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white";

export default function QuickBooksTab() {
  return (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm text-blue-800">
        Prime Comfort Solutions is the system of record. QuickBooks Desktop has no server
        of its own, so this only works with <strong>QuickBooks Web
        Connector</strong> — a small app that runs next to QuickBooks Desktop
        and polls this connection on its own schedule. There is no true
        instant/real-time push; the closest is Web Connector polling
        frequently, plus a manual retry here anytime.
      </div>
      <ConnectionCard />
      <SyncQueueCard />
      <ItemMappingCard />
    </div>
  );
}

function ConnectionCard() {
  const { data: settings, isLoading } = useQuickBooksSettings();
  const save = useSaveQuickBooksSettings();
  const resync = useResyncQuickBooksCustomers();

  const [isEnabled, setIsEnabled] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [salesTaxItemName, setSalesTaxItemName] = useState("");
  const [depositToAccountName, setDepositToAccountName] = useState("");
  const [loaded, setLoaded] = useState(false);

  if (settings && !loaded) {
    setLoaded(true);
    setIsEnabled(settings.isEnabled);
    setUsername(settings.webConnectorUsername);
    setSalesTaxItemName(settings.salesTaxItemName);
    setDepositToAccountName(settings.depositToAccountName ?? "");
  }

  if (isLoading || !settings) return null;

  const isPlaceholder = settings.salesTaxItemName.startsWith("PLACEHOLDER");

  return (
    <Card title="Connection">
      {isPlaceholder && (
        <div className="mb-4 bg-yellow-50 border border-yellow-200 rounded-lg px-3.5 py-2.5 text-sm text-yellow-800">
          Sales tax item is still a placeholder — replace it with the real
          QuickBooks Item name before enabling invoice sync (customer sync
          works regardless).
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save.mutateAsync({
            isEnabled,
            webConnectorUsername: username,
            ...(password && { webConnectorPassword: password }),
            salesTaxItemName,
            depositToAccountName: depositToAccountName || undefined,
          });
          setPassword("");
        }}
        className="space-y-4"
      >
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => {
              setIsEnabled(e.target.checked);
            }}
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          Sync is enabled
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Web Connector username
            </label>
            <input
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
              }}
              className={INPUT}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Web Connector password{" "}
              <span className="text-gray-400 font-normal">
                ({settings.hasPassword ? "leave blank to keep current" : "not set yet"})
              </span>
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
              className={INPUT}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Sales Tax Item name (QuickBooks)
            </label>
            <input
              value={salesTaxItemName}
              onChange={(e) => {
                setSalesTaxItemName(e.target.value);
              }}
              className={INPUT}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Deposit-to account{" "}
              <span className="text-gray-400 font-normal">(blank = Undeposited Funds)</span>
            </label>
            <input
              value={depositToAccountName}
              onChange={(e) => {
                setDepositToAccountName(e.target.value);
              }}
              className={INPUT}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <p className="text-xs text-gray-500">
            Last sync:{" "}
            {settings.lastSyncCompletedAt
              ? formatDateTime(settings.lastSyncCompletedAt)
              : "never"}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon={<ArrowDownTrayIcon className="h-4 w-4" />}
              onClick={() => {
                void downloadQuickBooksConnectorFile();
              }}
            >
              Download connector file (.qwc)
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon={<ArrowPathIcon className="h-4 w-4" />}
              loading={resync.isPending}
              onClick={() => {
                void resync.mutateAsync();
              }}
            >
              Resync all customers
            </Button>
            <Button type="submit" size="sm" loading={save.isPending}>
              Save
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

function SyncQueueCard() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const { data, isLoading } = useQuickBooksQueue({
    page,
    limit: 10,
    ...(status ? { status } : {}),
  });
  const retry = useRetryQuickBooksJob();
  const { getLabel: getEntityLabel } = useLookup("quickbooksEntityType");

  const jobs = data?.data ?? [];

  return (
    <Card title="Sync queue">
      <div className="flex items-center justify-between mb-3">
        <LookupSelect
          category="quickbooksSyncStatus"
          placeholder="All statuses"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="w-44"
        />
        <p className="text-sm text-gray-500">{data?.pagination.total ?? 0} job(s)</p>
      </div>
      {isLoading ? (
        <p className="text-sm text-gray-400 py-4 text-center">Loading\u2026</p>
      ) : jobs.length === 0 ? (
        <EmptyState
          title="Nothing queued"
          description="Changes to synced records show up here as soon as they happen."
        />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
              <th className="py-2 font-medium">Entity</th>
              <th className="py-2 font-medium">Op</th>
              <th className="py-2 font-medium">Status</th>
              <th className="py-2 font-medium">Updated</th>
              <th className="py-2 font-medium">Error</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {jobs.map((j) => (
              <tr key={j.id}>
                <td className="py-2.5 text-gray-700">
                  <span className="text-xs text-gray-400 mr-1">
                    {getEntityLabel(j.entityType)}
                  </span>
                  {j.entityLabel ?? j.entityId.slice(0, 8)}
                </td>
                <td className="py-2.5 text-gray-500 text-xs capitalize">{j.operation}</td>
                <td className="py-2.5">
                  <StatusBadge status={j.status} category="quickbooksSyncStatus" />
                </td>
                <td className="py-2.5 text-gray-500 text-xs">
                  {formatDateTime(j.updatedAt)}
                </td>
                <td className="py-2.5 text-red-600 text-xs max-w-xs truncate" title={j.lastError}>
                  {j.lastError ?? "-"}
                </td>
                <td className="py-2.5 text-right">
                  {j.status === "error" && (
                    <button
                      onClick={() => {
                        retry.mutate(j.id);
                      }}
                      className="text-xs text-primary-600 hover:text-primary-700 font-medium"
                    >
                      Retry
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && data.pagination.totalPages > 1 && (
        <div className="mt-3">
          <Pagination page={page} totalPages={data.pagination.totalPages} onPageChange={setPage} />
        </div>
      )}
    </Card>
  );
}

function ItemMappingCard() {
  const { data: mappings } = useQuickBooksItemMappings();
  const { data: pricebookItems } = usePricebookItems();
  const { options: lineItemTypeOptions } = useLookup("lineItemType");
  const save = useSaveQuickBooksItemMapping();
  const del = useDeleteQuickBooksItemMapping();

  const [mode, setMode] = useState<"category" | "item">("category");
  const [lineItemType, setLineItemType] = useState("");
  const [pricebookItemId, setPricebookItemId] = useState("");
  const [quickbooksItemName, setQuickbooksItemName] = useState("");

  return (
    <Card title="QuickBooks Item mapping">
      <p className="text-sm text-gray-500 mb-4">
        Every invoice line needs a matching QuickBooks Item. Map a whole
        category as a fallback (e.g. all "Parts" lines), or override a
        specific pricebook item. These are placeholders until the bookkeeper
        provides real Item names.
      </p>

      {mappings && mappings.length > 0 ? (
        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
              <th className="py-2 font-medium">Maps</th>
              <th className="py-2 font-medium">QuickBooks Item</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {mappings.map((m) => (
              <tr key={m.id}>
                <td className="py-2.5 text-gray-700">
                  {m.pricebookItem
                    ? `Item: ${m.pricebookItem.name}`
                    : `Category: ${m.lineItemType ?? "-"}`}
                </td>
                <td className="py-2.5 font-medium text-gray-900">
                  {m.quickbooksItemName.startsWith("PLACEHOLDER") ? (
                    <span className="text-yellow-700">{m.quickbooksItemName}</span>
                  ) : (
                    m.quickbooksItemName
                  )}
                </td>
                <td className="py-2.5 text-right">
                  <button
                    onClick={() => {
                      del.mutate(m.id);
                    }}
                    className="p-1 text-gray-400 hover:text-red-500"
                    aria-label="Remove mapping"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-gray-400 mb-4">No mappings yet.</p>
      )}

      <div className="border-t border-gray-100 pt-4 space-y-3">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit text-xs">
          <button
            type="button"
            onClick={() => {
              setMode("category");
            }}
            className={`px-3 py-1.5 rounded-md font-medium ${mode === "category" ? "bg-white shadow-sm" : "text-gray-500"}`}
          >
            By category
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("item");
            }}
            className={`px-3 py-1.5 rounded-md font-medium ${mode === "item" ? "bg-white shadow-sm" : "text-gray-500"}`}
          >
            Specific item
          </button>
        </div>
        <div className="grid grid-cols-12 gap-2 items-end">
          <div className="col-span-5">
            {mode === "category" ? (
              <select
                value={lineItemType}
                onChange={(e) => {
                  setLineItemType(e.target.value);
                }}
                className={INPUT}
              >
                <option value="">Select category...</option>
                {lineItemTypeOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={pricebookItemId}
                onChange={(e) => {
                  setPricebookItemId(e.target.value);
                }}
                className={INPUT}
              >
                <option value="">Select item...</option>
                {(pricebookItems ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="col-span-5">
            <input
              value={quickbooksItemName}
              onChange={(e) => {
                setQuickbooksItemName(e.target.value);
              }}
              placeholder="QuickBooks Item name"
              className={INPUT}
            />
          </div>
          <div className="col-span-2">
            <Button
              size="sm"
              className="w-full"
              loading={save.isPending}
              disabled={
                !quickbooksItemName || (mode === "category" ? !lineItemType : !pricebookItemId)
              }
              onClick={() => {
                void save
                  .mutateAsync({
                    ...(mode === "category" ? { lineItemType } : { pricebookItemId }),
                    quickbooksItemName,
                  })
                  .then(() => {
                    setLineItemType("");
                    setPricebookItemId("");
                    setQuickbooksItemName("");
                  });
              }}
            >
              Add
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
