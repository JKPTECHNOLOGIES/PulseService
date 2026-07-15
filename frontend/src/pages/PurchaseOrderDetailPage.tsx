import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeftIcon,
  TruckIcon,
  ArrowUturnLeftIcon,
} from "@heroicons/react/24/outline";
import Button from "../components/ui/Button";
import Modal from "../components/ui/Modal";
import { StatusBadge } from "../components/ui/Badge";
import { PageSpinner } from "../components/ui/Spinner";
import { NumberInput } from "../components/ui/NumberInput";
import { Can } from "../components/ui/Can";
import {
  formatCurrency,
  formatDate,
  formatDateTime,
} from "../utils/formatters";
import {
  usePurchaseOrder,
  useSetPOStatus,
  useReceiveItems,
  useReverseReceipt,
  type ReceiveLineInput,
} from "../hooks/usePurchasing";
import { useStockLocations } from "../hooks/useInventory";
import type { POLine, PurchaseOrder } from "../types";

const num = (v: unknown) => Number(v ?? 0);
const INPUT =
  "w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white";

export default function PurchaseOrderDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: po, isLoading } = usePurchaseOrder(id);
  const setStatus = useSetPOStatus();
  const reverseReceipt = useReverseReceipt();
  const [receiving, setReceiving] = useState(false);

  if (isLoading || !po) return <PageSpinner />;

  const canReceive =
    po.status === "ordered" || po.status === "partially_received";

  return (
    <div className="space-y-5">
      <button
        onClick={() => {
          navigate("/purchasing");
        }}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeftIcon className="h-4 w-4" /> Purchase Orders
      </button>

      {/* Header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">{po.poNumber}</h1>
              <StatusBadge status={po.status} category="poStatus" />
            </div>
            <p className="text-sm text-gray-500 mt-1">
              {po.vendor?.name} · Ordered {formatDate(po.orderDate)}
              {po.expectedDate
                ? ` · Expected ${formatDate(po.expectedDate)}`
                : ""}
            </p>
            {po.shipToLocation && (
              <p className="text-xs text-gray-400 mt-0.5">
                Ship to {po.shipToLocation.name} ({po.shipToLocation.code})
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Can permission="purchasing.manage">
              {po.status === "draft" && (
                <Button
                  size="sm"
                  onClick={() => {
                    setStatus.mutate({ id: po.id, status: "ordered" });
                  }}
                  loading={setStatus.isPending}
                >
                  Mark Ordered
                </Button>
              )}
              {po.status === "received" && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setStatus.mutate({ id: po.id, status: "closed" });
                  }}
                >
                  Close
                </Button>
              )}
              {po.status !== "cancelled" && po.status !== "received" && (
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    setStatus.mutate({ id: po.id, status: "cancelled" });
                  }}
                >
                  Cancel
                </Button>
              )}
            </Can>
            <Can permission="purchasing.receive">
              {canReceive && (
                <Button
                  size="sm"
                  icon={<TruckIcon className="h-4 w-4" />}
                  onClick={() => {
                    setReceiving(true);
                  }}
                >
                  Receive
                </Button>
              )}
            </Can>
          </div>
        </div>
      </div>

      {/* Lines */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Mobile: stacked cards */}
        <div className="md:hidden divide-y divide-gray-50">
          {(po.lines ?? []).map((l) => (
            <div key={l.id} className="p-4">
              <div className="font-medium text-gray-900">{l.description}</div>
              {l.inventoryItem && (
                <div className="font-mono text-xs text-gray-400">
                  {l.inventoryItem.sku}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
                <span>
                  Ordered{" "}
                  <span className="font-medium text-gray-700">
                    {num(l.quantity)}
                  </span>
                </span>
                <span>
                  Received{" "}
                  <span
                    className={
                      num(l.receivedQuantity) >= num(l.quantity)
                        ? "font-medium text-green-700"
                        : "font-medium text-gray-700"
                    }
                  >
                    {num(l.receivedQuantity)}
                  </span>
                </span>
                <span>
                  Unit{" "}
                  <span className="font-medium text-gray-700">
                    {formatCurrency(num(l.unitPrice))}
                  </span>
                </span>
                <span className="ml-auto">
                  Total{" "}
                  <span className="font-semibold text-gray-900">
                    {formatCurrency(num(l.totalPrice))}
                  </span>
                </span>
              </div>
            </div>
          ))}
          <div className="flex justify-between p-4 border-t border-gray-100">
            <span className="text-gray-500">Total</span>
            <span className="font-semibold text-gray-900">
              {formatCurrency(num(po.totalAmount))}
            </span>
          </div>
        </div>
        {/* Desktop: table */}
        <table className="hidden md:table w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
              <th className="py-3 px-4 font-medium">Item</th>
              <th className="py-3 px-4 font-medium text-right">Ordered</th>
              <th className="py-3 px-4 font-medium text-right">Received</th>
              <th className="py-3 px-4 font-medium text-right">Unit Price</th>
              <th className="py-3 px-4 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(po.lines ?? []).map((l) => (
              <tr key={l.id}>
                <td className="py-3 px-4">
                  <div className="font-medium text-gray-900">
                    {l.description}
                  </div>
                  {l.inventoryItem && (
                    <div className="font-mono text-xs text-gray-400">
                      {l.inventoryItem.sku}
                    </div>
                  )}
                </td>
                <td className="py-3 px-4 text-right text-gray-700">
                  {num(l.quantity)}
                </td>
                <td className="py-3 px-4 text-right">
                  <span
                    className={
                      num(l.receivedQuantity) >= num(l.quantity)
                        ? "text-green-700 font-medium"
                        : "text-gray-500"
                    }
                  >
                    {num(l.receivedQuantity)}
                  </span>
                </td>
                <td className="py-3 px-4 text-right text-gray-600">
                  {formatCurrency(num(l.unitPrice))}
                </td>
                <td className="py-3 px-4 text-right text-gray-700">
                  {formatCurrency(num(l.totalPrice))}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-gray-100">
              <td colSpan={4} className="py-3 px-4 text-right text-gray-500">
                Total
              </td>
              <td className="py-3 px-4 text-right font-semibold text-gray-900">
                {formatCurrency(num(po.totalAmount))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Receipts */}
      <ReceiptHistory po={po} onReverse={reverseReceipt} />

      {receiving && (
        <ReceiveModal
          po={po}
          onClose={() => {
            setReceiving(false);
          }}
        />
      )}
    </div>
  );
}

function ReceiptHistory({
  po,
  onReverse,
}: {
  po: PurchaseOrder;
  onReverse: ReturnType<typeof useReverseReceipt>;
}) {
  const receipts = (po.lines ?? []).flatMap((l) =>
    (l.receipts ?? []).map((r) => ({ line: l, receipt: r })),
  );
  if (receipts.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">
        Receipt history
      </h2>
      <div className="space-y-2">
        {receipts.map(({ line, receipt }) => (
          <div
            key={receipt.id}
            className="flex items-center justify-between text-sm border border-gray-100 rounded-lg px-3 py-2"
          >
            <div>
              <span className="font-mono text-xs text-gray-500">
                {receipt.receiptNumber}
              </span>{" "}
              <span className="text-gray-700">{line.description}</span>
              <div className="text-xs text-gray-400">
                {num(receipt.quantityReceived)} @{" "}
                {formatCurrency(num(receipt.unitCost))} into{" "}
                {receipt.stockLocation?.code ?? "-"} ·{" "}
                {formatDateTime(receipt.receivedAt)}
                {receipt.serialNumbers.length > 0 &&
                  ` · serials: ${receipt.serialNumbers.join(", ")}`}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge status={receipt.status} category="receiptStatus" />
              {receipt.status === "active" && (
                <Can permission="purchasing.receive">
                  <button
                    onClick={() => {
                      onReverse.mutate({ id: po.id, receiptId: receipt.id });
                    }}
                    className="p-1.5 text-gray-400 hover:text-red-500"
                    aria-label="Reverse receipt"
                    title="Reverse receipt"
                  >
                    <ArrowUturnLeftIcon className="h-4 w-4" />
                  </button>
                </Can>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface ReceiveRow {
  quantityReceived: number;
  stockLocationId: string;
  serials: string;
}

function ReceiveModal({
  po,
  onClose,
}: {
  po: PurchaseOrder;
  onClose: () => void;
}) {
  const receive = useReceiveItems();
  const { data: locations } = useStockLocations({ active: "true" });

  const openLines = (po.lines ?? []).filter(
    (l) =>
      l.lineStatus !== "cancelled" && num(l.receivedQuantity) < num(l.quantity),
  );
  const defaultLoc = po.shipToLocationId ?? "";

  const [rows, setRows] = useState<Record<string, ReceiveRow>>(() =>
    Object.fromEntries(
      openLines.map((l) => [
        l.id,
        {
          quantityReceived: num(l.quantity) - num(l.receivedQuantity),
          stockLocationId: defaultLoc,
          serials: "",
        },
      ]),
    ),
  );

  const update = (lineId: string, patch: Partial<ReceiveRow>) => {
    setRows((r) => ({ ...r, [lineId]: { ...r[lineId], ...patch } }));
  };

  const remaining = (l: POLine) => num(l.quantity) - num(l.receivedQuantity);

  const submit = () => {
    const items: ReceiveLineInput[] = [];
    for (const l of openLines) {
      const row = rows[l.id];
      if (row.quantityReceived <= 0) continue;
      const serialNumbers = row.serials
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      items.push({
        lineId: l.id,
        quantityReceived: row.quantityReceived,
        stockLocationId: row.stockLocationId || undefined,
        serialNumbers: serialNumbers.length ? serialNumbers : undefined,
      });
    }
    void receive.mutateAsync({ id: po.id, items }).then(() => {
      onClose();
    });
  };

  return (
    <Modal isOpen onClose={onClose} title={`Receive ${po.poNumber}`} size="xl">
      <div className="space-y-4">
        {openLines.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">
            All lines fully received.
          </p>
        ) : (
          openLines.map((l) => {
            const row = rows[l.id];
            const isSerial = !!l.inventoryItem && row.quantityReceived > 0;
            return (
              <div
                key={l.id}
                className="border border-gray-100 rounded-lg p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium text-gray-900">
                      {l.description}
                    </span>
                    {l.inventoryItem && (
                      <span className="font-mono text-xs text-gray-400 ml-2">
                        {l.inventoryItem.sku}
                      </span>
                    )}
                  </div>
                  <span className="text-xs text-gray-500">
                    {remaining(l)} remaining
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Qty to receive
                    </label>
                    <NumberInput
                      step="any"
                      max={remaining(l)}
                      value={row.quantityReceived}
                      onChange={(n) => {
                        update(l.id, {
                          quantityReceived: n ?? 0,
                        });
                      }}
                      className={INPUT}
                    />
                  </div>
                  {l.lineType === "inventory" && (
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">
                        Into location
                      </label>
                      <select
                        value={row.stockLocationId}
                        onChange={(e) => {
                          update(l.id, { stockLocationId: e.target.value });
                        }}
                        className={INPUT}
                      >
                        <option value="">Select...</option>
                        {(locations ?? []).map((loc) => (
                          <option key={loc.id} value={loc.id}>
                            {loc.name} ({loc.code})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                {isSerial && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      Serial numbers (comma or line separated, optional)
                    </label>
                    <textarea
                      rows={2}
                      value={row.serials}
                      onChange={(e) => {
                        update(l.id, { serials: e.target.value });
                      }}
                      className={`${INPUT} resize-none`}
                      placeholder="SN-001, SN-002"
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={receive.isPending}
            disabled={openLines.length === 0}
            onClick={submit}
          >
            Confirm receipt
          </Button>
        </div>
      </div>
    </Modal>
  );
}
