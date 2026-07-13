# Purchase Order System — Technical Reference

Application: CRN Plant Management (`pulseplant`)
Module: Purchasing / Purchase Orders

---

## 1. Architecture

```
React pages / components         src/app/(dashboard)/purchasing/**
        │
        ▼
Next.js API route handlers        src/app/api/purchasing/**/route.ts
        │
        ▼
Service layer                     src/services/purchasing/**
        │
        ▼
Prisma ORM  ──────────────────►  PostgreSQL
        │
        ├── Inventory stock updates (on receive of INVENTORY lines)
        └── GL + budget side-effects (po-gl.service, invoice-gl.service)
```

### Service layer map (`src/services/purchasing/`)
| Service / folder | Responsibility |
|------------------|----------------|
| `purchase-order/purchase-order.service.ts` | PO CRUD, list/search, totals, stats |
| `purchase-order/purchase-order-workflow.service.ts` | Status transitions (submit/approve/send/close) |
| `purchase-order/purchase-order-add-lines.service.ts` | Add lines to an existing PO |
| `purchase-order/purchase-order-cancellation.service.ts` | Cancel PO / cancel-for-edit |
| `purchase-order/purchase-order-line-scrap.service.ts` | Cancel a single line (e.g. repairable scrap) |
| `purchase-order/line-item-receiving.service.ts` | **Receiving engine** (all line types) |
| `purchase-order/purchase-order-receiving.service.ts` | Receiving orchestration/history |
| `purchase-order/receipt-reversal.service.ts` | Reverse/void receipts |
| `purchase-order/purchase-order-requisition.service.ts` | Convert requisition → PO |
| `purchase-order/purchase-order-statistics.service.ts` | Dashboards/stats |
| `purchase-order/purchase-order-status.constants.ts` | Status enum + valid transitions |
| `po-gl.service.ts` | Posts GL for PO events |
| `invoice.service.ts` / `invoice-approval.service.ts` / `invoice-gl.service.ts` | 3-way match invoicing |
| `invoice-receipt-matching.service.ts` | Match invoices to receipts |
| `rma/**` | Return-to-vendor (RMA) workflow |
| `requisition/**` | Requisitions (optional upstream of POs) |

---

## 2. PO lifecycle (status machine)

`PurchaseOrderStatus` (stored as a `String` on `PurchaseOrder.status`):

```
Draft → Submitted → Approved → Ordered → PartiallyReceived → Received → Invoiced → Closed
                        │           │            │                │
                        └────── Cancelled (from Draft/Submitted/Approved/Ordered/PartiallyReceived)

Closed → PartiallyReceived   (reopen on receipt reversal)
Cancelled                    (terminal)
```

Exact allowed transitions (`purchase-order-status.constants.ts`):
| From | Allowed to |
|------|-----------|
| Draft | Submitted, Cancelled |
| Submitted | Approved, Draft (reject), Cancelled |
| Approved | Ordered, Cancelled |
| Ordered | PartiallyReceived, Received, Invoiced, Closed, Cancelled |
| PartiallyReceived | Received, Invoiced, Closed, Cancelled |
| Received | PartiallyReceived (reopen), Invoiced, Closed |
| Invoiced | Closed |
| Closed | PartiallyReceived (reopen on receipt reversal) |
| Cancelled | (none — terminal) |

`isValidPOTransition(from, to)` enforces these at runtime.

> For a simpler target system you may collapse this to
> `Draft → Ordered → PartiallyReceived → Received → Closed (+ Cancelled)` and drop the
> approval/invoice states. The receiving logic does not depend on the approval steps.

---

## 3. Line types

`POLine.lineType` (`LineItemType` enum): each type has its own receiving path in
`line-item-receiving.service.ts`.

| Line type | Meaning | On receive |
|-----------|---------|-----------|
| `INVENTORY` | Stocked item (has `inventoryItemId`) | Creates receipt **and increments `InventoryStock` at `(item, storeId, bin)`** |
| `NON_STOCK` | Bought but not held in stock | Creates receipt only (no stock movement) |
| `SERVICE` | Labour/service, dollar-based; requires invoice match | Dollar-based receiving; `requiresInvoiceMatch = true` |
| `CONSUMABLE` | Consumed goods with usage tracking | Creates receipt + `ConsumableUsage` |
| `REPAIRABLE_RETURN` | A serialized part returning from vendor repair | Updates the repairable serial + repair history |

For the target company, the two that matter are **INVENTORY** (goes to a truck/warehouse) and
**NON_STOCK** (expense purchase). SERVICE/CONSUMABLE/REPAIRABLE can be omitted if not needed.

---

## 4. Data model (summary — full detail in `02-data-model.md`)

- **`PurchaseOrder`** — header: `poNumber` (unique), `supplierId`, `status`, dates, totals
  (`totalAmount`, `taxAmount`, `shippingCost`), buyer/approver, vendor + ship-to address snapshots,
  requisition/work-order back-links.
- **`POLine`** — one row per ordered item: `lineType`, `inventoryItemId?`, `description`,
  `quantity`, `unitPrice`, `totalPrice`, `receivedQuantity` (denormalized cache), `lineStatus`
  (`OPEN`/`CANCELLED`), charge allocations, receipts.
- **`POLineReceipt`** — one row per receiving event: `quantityReceived`, `unitCost`, `totalCost`,
  `receivedBy`, `receivedAt`, **`storeId`** (destination), `bin?`, `lotNumber?`, `serialNumbers[]`,
  `documentNumber?` (packing slip), `status` (`ACTIVE`/`REVERSED`/`VOIDED`), `isReturn`.
- **`ServiceReceipt` / `ConsumableUsage`** — per-receipt detail for SERVICE/CONSUMABLE lines.
- **`POLineChargeAllocation`** — GL/budget coding split for a line (account/dept/project/area).
- **`PurchaseOrderReturn` / `POLineReturn`** — RMA (return to vendor).
- **`DocumentCounter`** — race-free sequence generator for PO/REQ/RECEIPT numbers.

---

## 5. Receiving flow (the important part)

Endpoint: `POST /api/purchasing/purchase-orders/[id]/receive-items`
(payload validated by `receiveItemsSchema`).

Payload shape:
```jsonc
{
  "items": [
    {
      "itemId": "<POLine id>",
      "quantityReceived": 10,
      "storeId": "<Store id — the warehouse or a specific truck>",
      "notes": "optional"
    }
  ],
  "receivedBy": "<user id/name>",
  "receivedDate": "2026-01-01T00:00:00Z",   // optional
  "notes": "optional"
}
```

Engine: `LineItemReceivingService.batchReceive(...)`. For each item:
1. Loads the PO line; validates it can be received (not cancelled, within tolerance).
2. Idempotency + drift self-heal: recomputes `receivedQuantity`/`receivedAmount` from the sum of
   ACTIVE, non-return receipts before the over-receive check.
3. Dispatches to the type-specific handler:
   - `receiveInventoryItem` → creates `POLineReceipt` (with `storeId`, `bin`) **and increments
     `InventoryStock` at `(inventoryItemId, storeId, bin)`**. Auto-generates repairable serials if
     the item is repairable.
   - `receiveNonStockItem` / `receiveServiceItem` / `receiveConsumableItem` /
     `receiveRepairableReturnItem` → create the receipt + type-specific side records.
4. Updates `POLine.receivedQuantity`/`receivedAmount`, recomputes PO status
   (`PartiallyReceived` vs `Received`), and posts GL + budget updates.

Reversal: `POST /api/purchasing/purchase-orders/[id]/receipts/[receiptId]/reverse`
(`receipt-reversal.service.ts`) — marks the receipt `REVERSED`, backs the stock out, reverses GL,
unlinks the invoice, and reopens PO status if needed.

> **Key takeaway for the port:** the receive screen already lets the receiver choose a destination
> `storeId` per line. Model the internal warehouse and each truck as `Store` records and this "assign
> to a truck / internal warehouse" requirement is satisfied natively. See
> `04-receiving-and-locations-adaptation.md`.

---

## 6. Numbering
PO / receipt / requisition numbers come from `DocumentCounter` — a single-row-per-sequence table
incremented with one atomic `UPDATE nextValue += 1` (no scans, no races). Receipt numbers are of the
form `RCT-YYYYMM-<seq>` (see `generateReceiptNumber`).

---

## 7. Key files
- Schema: `prisma/schema/purchasing.prisma` (copied here as `purchasing.prisma`); upstream
  `prisma/schema/requisitions.prisma`.
- Services: `src/services/purchasing/**`.
- API: `src/app/api/purchasing/**/route.ts`.
- Types & Zod: `src/services/purchasing/purchase-order/purchase-order.types.ts`.
