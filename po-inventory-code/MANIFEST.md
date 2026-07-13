# PO + Inventory Source Bundle — Manifest

This archive contains the **actual source code** for the Purchase Order and Inventory subsystems
of the CRN Plant Management app (`pulseplant`), plus the technical docs, so another AI/dev can port
or reference them.

## Stack
Next.js (App Router) + TypeScript · Prisma ORM · PostgreSQL · NextAuth. Layering:
UI → API route handlers (`src/app/api/**`) → services (`src/services/**`) → Prisma → PostgreSQL.

## Folder layout (mirrors the original repo)
```
prisma/schema/*.prisma          All 36 Prisma schema files (complete data model / shared contract)
src/services/inventory/**       Inventory business logic (51 files)
src/services/purchasing/**      Purchasing / PO business logic (56 files)
src/app/api/inventory/**        Inventory REST endpoints (106 route files)
src/app/api/purchasing/**       Purchasing REST endpoints (127 route files)
docs/inventory-system-docs/**   Written technical docs for inventory
docs/po-system-docs/**          Written technical docs for PO + the truck/warehouse adaptation guide
```
Total: 390 files.

## Where to start (for the PO port to the simpler warehouse + trucks model)
1. `docs/po-system-docs/04-receiving-and-locations-adaptation.md` — the plan: trucks/warehouse = `Store`,
   receiving assigns `storeId`, drop bins, what to keep/drop.
2. `prisma/schema/purchasing.prisma`, `prisma/schema/inventory.prisma` — the core data model.
3. `src/services/purchasing/purchase-order/purchase-order.types.ts` — PO + `receiveItemsSchema` (Zod).
4. `src/services/purchasing/purchase-order/line-item-receiving.service.ts` — the receiving engine
   (creates `POLineReceipt`, increments `InventoryStock` at `(item, storeId, bin)`).
5. `src/services/purchasing/purchase-order/purchase-order-status.constants.ts` — status machine.
6. `src/app/api/purchasing/purchase-orders/[id]/receive-items/route.ts` — receive endpoint.
7. `src/app/api/inventory/stores/**` — Store (location) CRUD.

## Key facts the porting AI must respect
- **Locations = `Store` records.** Model the internal warehouse and each truck as one `Store`.
- **Receiving already takes `storeId` per line** (`receiveItemsSchema`); INVENTORY lines move stock
  into `InventoryStock (inventoryItemId, storeId, bin)`. `bin` defaults to `"MAIN"` — bins can be dropped.
- **`POLine.receivedQuantity`/`receivedAmount` are denormalized caches** — recompute from ACTIVE,
  non-return `POLineReceipt` rows before any over-receive check (the source self-heals on write).
- **Transactions/receipts are append-only and reversible** — never hard-delete; reverse instead.
- **Prisma enums** (`ReceiptStatus`, `POLineStatus`, `LineItemType`, `ReservationStatus`, etc.) must
  be used as imported enum values, never raw strings, in `where` filters.

## Not included (referenced but out of scope)
These are imported by the services but were not bundled to keep scope tight. Ask if you need them:
- Shared libs (`src/lib/**` — Prisma client, API handler helpers, auth/permissions).
- GL & budget services (`src/services/gl/**`, `src/services/budget/**`) — receiving calls these to
  post journal entries; the adaptation guide explains how to stub/drop them if the target has no GL.
- Supplier / invoice / work-order / requisition services beyond the copies here.
- UI pages (`src/app/(dashboard)/**`).

The Prisma schema is complete (all 36 files), so the full data model and every relation is available
even for tables whose services weren't bundled.
