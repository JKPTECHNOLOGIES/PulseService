# Receiving & Locations — Adaptation Guide for the Target System

**Target model:** one internal **warehouse** + several **trucks that are also warehouses**, **no bins**.
Workflow: create a PO → when goods arrive, receive them and assign each received line to a truck
or the internal warehouse.

This guide shows how the existing PO system already supports that, and exactly what to keep,
change, or drop.

---

## 1. The core mapping: locations = `Store` records

The source system's stocking location is the **`Store`** model (`inventory.prisma`). Stock lives in
`InventoryStock`, keyed by `(inventoryItemId, storeId, bin)`. A receipt (`POLineReceipt`) records
which `storeId` it went to.

**Map every physical location to one `Store`:**

| Real-world location | `Store` record |
|---------------------|----------------|
| Internal warehouse | `Store { name: "Main Warehouse", code: "WH" }` |
| Truck 1 | `Store { name: "Truck 101", code: "TRK101" }` |
| Truck 2 | `Store { name: "Truck 102", code: "TRK102" }` |
| … | one Store per truck |

`Store` fields you need: `name` (unique), `code` (unique), `isActive`, optional `locationId`,
`description`. Create them via `POST /api/inventory/stores` (or seed directly).

> Result: stock-on-hand is naturally tracked **per truck and per warehouse**. Asking "how much of
> SKU X is on Truck 101?" is just `InventoryStock` where `storeId = Truck 101`.

## 2. Drop bins (no schema change required)

`InventoryStock.bin` and `POLineReceipt.bin` default to `"MAIN"`. The receiving engine already
falls back to `MAIN` when no bin is supplied. So:

- **Do nothing** and every location uses a single implicit `MAIN` bin, or
- Optionally hide the bin field from the UI entirely.

You do **not** need to remove the `bin` column; leaving it at `"MAIN"` is the simplest, safest path
and keeps the `(item, store, bin)` unique key intact.

## 3. Receiving assigns the destination — already built in

Endpoint: `POST /api/purchasing/purchase-orders/[id]/receive-items`
Validated by `receiveItemsSchema` (`purchase-order.types.ts`):

```jsonc
{
  "items": [
    {
      "itemId": "<POLine id>",
      "quantityReceived": 10,
      "storeId": "<Store id of the truck OR the warehouse>",   // ← the assignment
      "notes": "optional"
    }
  ],
  "receivedBy": "<user>",
  "receivedDate": "2026-01-01T00:00:00Z",   // optional
  "notes": "optional"
}
```

What happens for an `INVENTORY` line (`LineItemReceivingService.receiveInventoryItem`):
1. Creates a `POLineReceipt` with the chosen `storeId` (and `bin = "MAIN"`).
2. Increments `InventoryStock` at `(inventoryItemId, storeId, "MAIN")` — i.e. adds the goods to that
   truck/warehouse.
3. Updates `POLine.receivedQuantity` and recomputes PO status
   (`PartiallyReceived` → `Received` when all lines are fully received).

**UI change needed:** on the receive screen, render a **Store dropdown per line** (list active
Stores = warehouse + trucks) and send the selected `storeId`. If most receipts go to the main
warehouse, default the dropdown to it. That's the entire "assign to a truck or internal warehouse"
feature — the backend already consumes `storeId`.

## 4. What to keep vs. drop for a simpler system

| Area | Recommendation |
|------|----------------|
| `PurchaseOrder`, `POLine`, `POLineReceipt`, `Store`, `InventoryItem`, `InventoryStock` | **Keep** — the backbone |
| `receiveItemsSchema` + `line-item-receiving.service` (INVENTORY + NON_STOCK paths) | **Keep** |
| Status machine | Optionally simplify to `Draft → Ordered → PartiallyReceived → Received → Closed (+ Cancelled)` |
| SERVICE / CONSUMABLE / REPAIRABLE_RETURN line types | **Drop** if not used (removes invoice-match + repairable complexity) |
| Requisitions + approval workflow (`requisitions.prisma`, approval-levels/settings) | **Drop** if they create POs directly |
| Invoicing / 3-way match (`invoice*.service`, `/api/purchasing/invoices/**`) | **Drop** if not doing AP here |
| RMA / returns (`PurchaseOrderReturn`, `rma/**`) | **Drop** unless vendor returns are needed |
| GL + budget posting (`po-gl.service`, `inventory-gl.service`, charge allocations) | **Drop or stub** if the target has no GL. Receiving still works — just skip the GL calls. |
| WAC costing (`wacProcessedAt`, `InventoryWACRun`) | **Drop** — use a simple `unitCost` |
| Tabware/NAV migration flags (`tabwareSettledAt*`, `nav-sync`) | **Drop** — source-plant specific |

## 5. Denormalized cache rule (carry this over — it caused real bugs)

`POLine.receivedQuantity` / `receivedAmount` are **denormalized caches** of the sum of ACTIVE,
non-return `POLineReceipt` rows. The source system self-heals them at the start of `batchReceive`
(recompute from the receipts before the over-receive check). **Keep this behaviour** in the port —
never trust the cache for over-receive decisions; recompute from receipts.

## 6. Receipt reversal / corrections
`POST /api/purchasing/purchase-orders/[id]/receipts/[receiptId]/reverse` marks the receipt
`REVERSED`, decrements the stock back out of that same `storeId`, and reopens PO status if needed.
Keep this — it's how you undo a mis-assigned truck/warehouse receipt. (Under the hood it writes a
reversing `InventoryTransaction`; stock movements are never hard-deleted.)

## 7. Minimal build checklist for the target system
- [ ] Create a `Store` for the warehouse and one per truck (`code` unique).
- [ ] PO create screen: supplier + line items (INVENTORY / NON_STOCK).
- [ ] Receive screen: per-line qty + **Store dropdown** (warehouse/trucks) → `POST .../receive-items`.
- [ ] Keep receipt reversal for corrections.
- [ ] Keep the `receivedQuantity` self-heal-from-receipts logic.
- [ ] Drop bins (leave `bin = "MAIN"`), invoicing, requisitions, GL/WAC, RMA unless needed.
- [ ] Stock-by-location report: group `InventoryStock` by `storeId`.
