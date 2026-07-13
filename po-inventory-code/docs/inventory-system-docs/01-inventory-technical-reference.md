# Inventory System — Technical Reference

Application: CRN Plant Management (`pulseplant`)
Module: Inventory Management

---

## 1. Architecture

```
React pages / components         src/app/(dashboard)/inventory/**/page.tsx
        │
        ▼
Next.js API route handlers        src/app/api/inventory/**/route.ts   (106 endpoints)
        │
        ▼
Service layer                     src/services/inventory/**            (business logic)
        │
        ▼
Prisma ORM  ──────────────────►  PostgreSQL
        │
        └── GL / Budget side-effects via inventory-gl.service.ts
```

### Technology
- **Framework:** Next.js App Router, TypeScript (strict).
- **Data:** Prisma ORM over PostgreSQL. Schema is split by domain under `prisma/schema/*.prisma`;
  the inventory tables live in `prisma/schema/inventory.prisma`.
- **Auth:** NextAuth; API handlers use shared helpers (`createGetHandler`,
  `createGetHandlerWithParams<{ id }>`, `parseQueryParams`) and permission checks via a
  `resource` guard on each service.
- **Validation:** Zod schemas defined in `inventory.types.ts` and per-feature `*.types.ts`.

### Service layer map (`src/services/inventory/`)
| Service | Responsibility |
|---------|----------------|
| `inventory.service.ts` (`InventoryServiceV2`) | Item CRUD, list/search, stock adjust/issue/receive/transfer, physical count, stats, low-stock, stock value, availability |
| `inventory-gl.service.ts` (`InventoryGLService`) | Posts GL transactions + budget updates for issue / return / adjustment / count-variance |
| `stock/inventory-stock.service.ts` | Core stock mutations, multi-bin handling, bin transfer |
| `transaction.service.ts` | Inventory transaction ledger: create, verify, reverse |
| `store.service.ts` | Storerooms (Stores) CRUD |
| `direct-issue/` | Direct-issue (issue straight to WO/equipment, incl. repairables) + returns |
| `reservation/` | Reservation lifecycle, availability, review, lead-time validation, settings |
| `cycle-count/` | Master cycle counts, ABC-driven scheduling, variance posting |
| `abc-classification/` | ABC (A/B/C/D) usage-value classification + history |
| `reorder.service.ts` | Reorder suggestions / dashboard |
| `inventory-monitor.service.ts` | Automated low-stock monitoring / auto-requisition |
| `inventory-automation.service.ts` | Rule-driven recommendations engine |
| `inventory-integrity.service.ts` | Data-integrity scan/execute (self-heal denormalized caches) |
| `inventory-item-supplier.service.ts` | Per-item multi-supplier records + performance |
| `assembly-tracking.service.ts` / `repair-work-order.service.ts` | Repairable / assembly BOM tracking |
| `inventory-settings.service.ts` | Global inventory module settings |

---

## 2. Core concepts

### Item types
An `InventoryItem` is characterised by three booleans:
- `isStockItem` — `true` = tracked storeroom stock; `false` = non-stock (direct purchase, not held).
- `isRepairable` — `true` = serialized repairable component (has `RepairableItem` serials, repair WOs).
- `isAssembly` — `true` = assembly whose BOM is learned/tracked (`RepairableAssemblyBOM`).

### Stock model (multi-store, multi-bin)
Physical stock lives in `InventoryStock`, uniquely keyed by
`(inventoryItemId, storeId, bin)`. Default bin is `"MAIN"`. Each row tracks:
- `quantityOnHand` — physical count.
- `quantityReserved` — soft-allocated to reservations / WOs.
- `quantityCommitted` — units already on order (active REQ/PO) for a specific WO.

**Availability formula** (`calculateAvailableQuantity`, `inventory.types.ts`):
```
available = Σ (quantityOnHand − quantityReserved − quantityCommitted)   over all stock rows
```
Note: items *in repair* are NOT re-subtracted — `quantityOnHand` was already decremented when
the item was direct-issued for repair, so subtracting an in-repair count would double-count.

### Costing (Weighted Average Cost)
`InventoryItem.unitCost` is the item's carrying cost. It is recalculated by the **monthly WAC run**
(`monthly-wac.service.ts`, Finance module). Every change to `unitCost` is written to
`InventoryItemCostHistory` with a `CostChangeSource` (`WAC_RUN`, `WAC_REVERSAL`, `REVALUATION`,
`MANUAL`, `IMPORT`). This history is used by the "Inventory In Stock" report to reconstruct
historical opening balances. See `WAC-HOW-IT-WORKS.md` and `04-business-rules-and-gotchas.md`.

A large-cost-change guard in `inventory.service.ts#update` requires a `costChangeReason` when the
new `unitCost` differs from the current by more than 5× or $50 (prevents typo-driven cost blowups).

### Transactions ledger
Every stock movement writes an `InventoryTransaction` (append-only ledger) with `transactionType`
(`Purchase | Issue | Adjustment | Return | Transfer`), before/after quantities, actor, reference
(work order / PO / direct issue), and full reversal linkage (`reversalOfId` / `reversedById`).
Transactions can be `verified` and `reversed` (self-referential `TransactionReversal` relation).

### Reservations
`InventoryReservation` soft-allocates stock to a consumer (usually a work order part).
Status lifecycle (`ReservationStatus`): `ACTIVE → PENDING_REVIEW / CONSUMED / CANCELLED / EXPIRED`,
plus `PENDING` for backorder/zero-stock reservations awaiting incoming stock. Reservations have a
1:1 link to `WorkOrderPart`. Behavior is tunable via `ReservationSettings`
(`TIME_BASED` vs `PROMPT_BASED`, thresholds, auto-requisition).

### GL & budget integration
`InventoryGLService` posts double-entry GL transactions and updates budget periods for:
- **Issue** (`createIssueTransaction`) — credit storeroom asset, debit expense/WIP per GL rule.
- **Return** (`createReturnTransaction`) — reverse of issue.
- **Adjustment** (`createAdjustmentTransaction`) — increase/decrease with GL rule resolution.
- **Count variance** (`createCountVarianceGL`) — posts the physical-count delta.

Account/department/project resolution walks a priority chain (explicit → project → equipment →
work order → finance defaults). Reference accounts seen in code include storeroom asset accounts
`1110` / `1535`. The actual account per event is resolved through the GL rules engine
(`glTransactionRuleId`), never hardcoded.

---

## 3. Primary workflows

### Create / edit item
`POST /api/inventory` → `inventory.service.create` — validates SKU uniqueness, optional supplier &
equipment links, min/max, cost. `PATCH /api/inventory/[id]` → `update` (cost-change guard,
supplier/equipment relink logging, repairable serial reconciliation).

### Receive stock
`POST /api/inventory/[id]/receive` → `receiveStock` — increments `quantityOnHand`, records a
`Purchase` transaction, optionally updates `unitCost`. (PO receiving proper lives in the purchasing
module; this is the item-level receive.)

### Issue stock
`POST /api/inventory/[id]/issue` → `issueStock` — decrements stock, records an `Issue` transaction,
posts the issue GL + budget update.

### Adjust / physical count
`POST /api/inventory/[id]/adjust` and `.../count` → `adjustStock` / `performStockCount` — writes the
delta, records the transaction, posts adjustment/variance GL. Counts set `lastCountDate`.

### Transfer (between stores) / bin transfer
`POST /api/inventory/[id]/transfer` (store→store) and `.../bin-transfer` (bin→bin within a store).

### Direct issue
`POST /api/inventory/direct-issues` — issue directly to a work order / equipment (bypassing a
reservation), including issuing repairables into repair. Returns via `.../[id]/return`.

### Reservations
Create (`/api/inventory/reservations`, or `.../create-with-requisition` to auto-raise a REQ on
shortage), confirm, consume, cancel, bulk-confirm, and a review queue (`pending-review`) with
lead-time validation.

### Cycle counting
`/api/inventory/cycle-count/**` — create counts (manually or `create-from-abc`), enter counts per
bin/item, recount, verify, review, approve/reject, and post variances to GL.

### ABC classification
`/api/inventory/abc-classification/**` — calculate A/B/C/D classes from rolling annual usage value,
view distribution/report, and drive cycle-count frequency.

---

## 4. Key files (source of truth)

- Data model: `prisma/schema/inventory.prisma` (copied into this package as `inventory.prisma`).
  Related schemas: `cycle-counts.prisma`, `repairables.prisma`, `suppliers.prisma`, `gl.prisma`,
  `budgets.prisma`, `wac.prisma`.
- Services: `src/services/inventory/**`.
- API: `src/app/api/inventory/**/route.ts`.
- UI: `src/app/(dashboard)/inventory/**/page.tsx`.
- Types & Zod: `src/services/inventory/inventory.types.ts` (+ per-feature `*.types.ts`).

See `02-data-model.md`, `03-api-reference.md`, and `04-business-rules-and-gotchas.md` for detail.
