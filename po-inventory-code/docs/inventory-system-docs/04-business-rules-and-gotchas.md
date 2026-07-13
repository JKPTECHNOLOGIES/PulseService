# Inventory — Business Rules, Costing & Known Gotchas

This document captures the non-obvious rules an integrating system must respect. Much of it comes
from production incidents; ignore at your own risk.

---

## 1. Availability & the three quantity buckets
`InventoryStock` carries three quantities per `(item, store, bin)`:
- `quantityOnHand` — physical.
- `quantityReserved` — soft-allocated (reservations / WO parts).
- `quantityCommitted` — already on order (active REQ/PO) for a specific WO.

```
available = Σ (quantityOnHand − quantityReserved − quantityCommitted)
```
**Do not** additionally subtract items "in repair": on-hand was already reduced when the repairable
was direct-issued to repair, and increased again on return. Subtracting an in-repair count is a
double-deduction (see `calculateAvailableQuantity` in `inventory.types.ts`).

## 2. Denormalized caches drift — always self-heal (M-021)
`POLine.receivedQuantity`/`receivedAmount` (and related aggregates) are denormalized caches of the
sum of active child records. They historically drift (legacy imports, old reversal paths). Rules:
- Never make UI/business decisions that require the cache to be fresh when an authoritative
  aggregation is available.
- Self-heal the cache on write at the entry of the relevant service.
- For SERVICE lines use the dollar-based `availableAmount`, not `remainingQty`.

## 3. Transactions are append-only + reversible
Never hard-delete an `InventoryTransaction`. Corrections are made by writing a **reversal**
transaction linked via `reversalOfId`/`reversedById` and flipping `isReversed`. Aggregations must
filter `isActive = true` and exclude reversed rows. The `isActive` flag is the canonical
"live row" signal used across the codebase.

## 4. Costing (Weighted Average Cost)
- `InventoryItem.unitCost` is the carrying cost, recalculated by the **monthly WAC run**
  (`monthly-wac.service.ts`). See `WAC-HOW-IT-WORKS.md`.
- WAC eligibility: PO `status = CLOSED`, `closedAt` in the run month, `wacProcessedAt` null, every
  inventory line fully received.
- Freight is only rolled into cost when **capitalized** (`FREIGHT_CAP` GL debit to the inventory
  asset account); expensed freight (`FREIGHT_EXP`) is excluded to avoid double-counting.
- New WAC formula:
  ```
  newWAC = (qtyOnHand × currentCost + totalReceiptValue + capitalizedFreight)
           ÷ (qtyOnHand + totalReceiptQty)
  ```
- **Every** `unitCost` change is journaled to `InventoryItemCostHistory` with a `CostChangeSource`.
  Historical reports reconstruct opening balances from this log — do not mutate `unitCost` without
  writing a cost-history record.
- A guard requires `costChangeReason` when a manual `unitCost` change exceeds 5× or $50 delta.

## 5. GL posting is mandatory on stock moves
Issue, return, adjustment, and count-variance operations MUST post GL + budget updates through
`InventoryGLService`. Account/department/project are resolved through the GL **rules engine**
(`glTransactionRuleId`) following the priority chain: explicit → project → equipment → work order →
finance defaults. Never hardcode account numbers. Storeroom asset accounts referenced in code
include `1110` and `1535`, but the effective account is always rule-resolved.

### Prisma enum discipline (M-019)
Fields backed by Prisma enums (e.g. `ReservationStatus`, `CostChangeSource`, `ABCClassification`,
`WorkOrderPartStatus`) must be filtered with the imported enum from `@prisma/client`, never raw
strings. Confirm every enum value against the schema before use.

## 6. Reservations
- 1:1 with `WorkOrderPart`.
- `PENDING` status = backorder/zero-stock reservation waiting for incoming stock (distinct from
  `ACTIVE`). Include the right statuses when summing reserved quantity.
- Behavior is governed by `ReservationSettings` (`TIME_BASED` vs `PROMPT_BASED`, `daysThreshold`,
  `promptOnStockShortage`, `promptOnMinQty`, `autoCreateReq`). `create-with-requisition` can raise a
  requisition automatically on shortage.

## 7. Repairables & assemblies
- Repairable items (`isRepairable`) carry serialized `RepairableItem` records. `inventory.service`
  reconciles serials against available on-hand (auto-generates placeholder serials to close gaps).
- Assembly BOM learning/tracking is gated by `InventorySettings.assemblyTrackingEnabled`.
- Outside-repair option visibility is gated by `InventorySettings.allowOutsideRepair`.

## 8. Service-PO amount linkage (M-024 / M-025)
For SERVICE POs, any invoice approval path must (a) create `InvoiceLineItem` junction records and
(b) increment `POLine.approvedInvoiceAmount`; the receive form depends on both. When diagnosing a
"can't receive" report, compare `sum(active receipts)` vs `sum(approved invoices)`:
- `receipts < invoices` → under-received (bump `approvedInvoiceAmount`).
- `receipts == invoices` **and** a receipt has `invoiceId = NULL` → already received, just relink
  the receipt to the invoice; do NOT bump amounts (would double-count).

## 9. Date handling in report/query services
Every service that accepts date strings must call `setHours(0,0,0,0)` on the start and
`setHours(23,59,59,999)` on the end after `new Date(...)`, or the range is off by the timezone
offset and misses the last day.

## 10. Cycle counts & ABC
- Cycle-count workflow: create (manual or `create-from-abc`) → count per bin/item → recount/verify
  → submit → review → approve/reject → post (variance GL).
- ABC classes (A/B/C/D) are computed from rolling annual usage value against
  `ABCClassificationSettings` thresholds; class drives `cycleCountFrequencyDays` and
  `nextCycleCountDate`. Archived / non-stock items are excluded from cycle counts.

---

## Integration checklist for the target system
- [ ] Treat `InventoryTransaction` as the authoritative movement ledger (append-only, reversible).
- [ ] Recompute availability with the three-bucket formula; don't trust a single "available" number.
- [ ] Mirror `InventoryItemCostHistory` if you replicate costs, so historical valuation stays correct.
- [ ] Post/replicate GL + budget effects for issue/return/adjustment/variance, or explicitly no-op them.
- [ ] Respect `isStockItem` / `isRepairable` / `isAssembly` semantics — they change every workflow.
- [ ] Honour `InventorySettings` and `ReservationSettings` toggles.
- [ ] Use Prisma enum values, not strings, for enum-backed fields.
