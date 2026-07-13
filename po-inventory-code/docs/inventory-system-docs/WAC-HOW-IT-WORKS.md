# How WAC (Weighted Average Cost) Works

**Module:** Finance → Inventory Costing  
**Status:** Built — awaiting first manual run  
**Last updated:** 2026-04-07

---

## What You Will See

### Finance Dashboard

`/finance` → Financial Operations section → **"Inventory Costing (WAC)"** card.

### Step 1 — WAC Main Page (`/finance/inventory-costing/wac`)

- Month picker (defaults to prior calendar month)
- **Preview Changes** button — navigates to the preview page for that month
- Run history table showing all past WAC runs with status, items updated, GL totals, and posted-by

### Step 2 — Preview Page (`/finance/inventory-costing/wac/preview?month=YYYY-MM`)

- Automatically fetches the WAC preview for the selected month on load
- Summary cards: eligible POs, items to update, items unchanged, total GL impact
- Full per-item table: SKU / Description / Current Cost / New WAC / Change / Qty On-Hand / GL Adjustment / Freight / PO count
- GL summary card showing net DR 1110 increases and CR 1110 decreases
- Collapsed section for unchanged items with the skip reason for each
- **Confirm & Sync** button — both at the top-right and in the bottom action bar
- Nothing is posted until Confirm & Sync is clicked
- After a successful post → redirected to the run detail page

### Run Detail Page (`/finance/inventory-costing/wac/[runId]`)

- Full summary cards (items updated, items skipped, GL debit total, GL credit total)
- Per-item table with old cost, new cost, GL adjustment, and a direct link to the GL transaction for each item
- Skipped items section with the reason (no material change / zero qty / negative qty)
- "Reverse Run" button — only visible for POSTED runs, only works while the fiscal period is still open

---

## What Happens When You Run a Preview

1. The system finds all POs in the selected month that are:
   - Status = `CLOSED`
   - `closedAt` is within the selected month
   - Not already WAC-processed (`wacProcessedAt` is null)
   - Every inventory line is fully received (`receivedQuantity >= quantity`)

2. For each eligible PO it checks whether freight was **capitalized** to inventory (i.e. a `FREIGHT_CAP` GL entry exists debiting account `1110`). If freight was expensed instead (`FREIGHT_EXP`), it is excluded — including it would double-count: the expense stays on P&L and inventory would also increase.

3. For every inventory item that appears on those POs, it computes:

```
newWAC = (currentQtyOnHand × currentUnitCost + totalReceiptValue + capitalizedFreight)
         ÷ (currentQtyOnHand + totalReceiptQty)
```

4. The GL adjustment for each item is:

```
glAdjustment = currentQtyOnHand × (newWAC − currentUnitCost)
```

5. Items are marked as **skipped** (no write, no GL) when:
   - `abs(newWAC - currentUnitCost) < $0.01` → `NO_MATERIAL_CHANGE`
   - `currentQtyOnHand = 0` → `ZERO_QTY_NO_GL` (unitCost will still be updated on post, but no GL entry)
   - `currentQtyOnHand < 0` → `NEGATIVE_QTY_SKIPPED` (needs manual investigation)

Nothing is written to the database during a preview. It is entirely read-only.

---

## What Happens When You Confirm and Post

All steps are atomic — if anything fails, the entire run rolls back.

1. Checks the fiscal period covering the selected month is open (not locked).
2. Resolves GL accounts `1110` (Inventory Asset) and `5400` (Inventory Adjustment).
3. Creates an `InventoryWACRun` record with status `POSTING` — this acts as an in-flight guard preventing a concurrent run for the same month.
4. For each non-skipped item, posts a GL entry:
   - Cost increased: **DR 1110 / CR 5400**
   - Cost decreased: **DR 5400 / CR 1110**
   - Zero adjustment (zero on-hand): no GL entry
5. Every GL transaction is tagged with:
   - `referenceType = 'INVENTORY_WAC_REVALUATION'`
   - `referenceNumber = 'WAC-{YYYY-MM}-{SKU}'`
   - Description includes old cost → new cost, qty on-hand, adjustment amount, and the RunId
6. Updates `InventoryItem.unitCost` to the new WAC for each item.
7. Sets `wacProcessedAt` and `wacRunId` on every PO that contributed — these POs will never be counted again in a future run.
8. Writes an `InventoryWACRunItem` record per item (including skipped items) for the audit trail.
9. Sets the run status to `POSTED`.

---

## What Happens to the GL

Two accounts are affected, same ones used by manual revaluations:

| Account | Number | Role |
|---|---|---|
| Inventory Asset | `1110` | Debited when inventory value increases, credited when it decreases |
| Inventory Adjustment | `5400` | Offset account — the other side of every WAC entry |

**Finding WAC entries later:**

```sql
-- All WAC GL entries ever posted
SELECT * FROM gl_transactions
WHERE reference_type = 'INVENTORY_WAC_REVALUATION'
ORDER BY transaction_date DESC;

-- All entries for a specific run
SELECT * FROM gl_transactions
WHERE description LIKE '%RunId:<paste-run-id-here>%';

-- All entries for a specific month
SELECT * FROM gl_transactions
WHERE reference_type = 'INVENTORY_WAC_REVALUATION'
  AND reference_number LIKE 'WAC-2026-03-%';
```

---

## What Happens to Inventory Costs

`InventoryItem.unitCost` is updated to the new WAC value after a successful post.

**What this affects going forward:**
- Inventory value reports (`/api/inventory/total-value`) — will reflect accurate costs
- New parts added to open Work Orders — will use the new rate
- New Requisitions created after the run — will use the new rate
- Cycle count variance GL — will use the updated cost

**What this does NOT change:**
- `InventoryTransaction.unitCost` — this is locked at the time each transaction was created (issue, receipt, adjustment). Historical transactions are immutable.
- `WorkOrderPart.unitCost` — locked when the part was added to the WO. WAC never touches WO part rows.
- Completed or Closed Work Orders — `recalculateCosts()` will reject any call against a completed or closed WO with an explicit error.
- `POLineReceipt.unitCost` — locked at time of receipt, never changed.
- `SupplierCostUpdateService` — updates `InventoryItemSupplier.unitCost` (the per-supplier catalog price). This is independent of `InventoryItem.unitCost` and unaffected by WAC.

---

## How to Reverse a Run

1. Open the run detail page (`/finance/inventory-costing/wac/[runId]`).
2. Click **"Reverse Run"** (only visible for POSTED runs).
3. Enter a reason (minimum 10 characters).
4. Click **"Confirm Reversal"**.

The system will:
- Reverse every GL transaction via `glReversalService` (sign-flipped offsetting entries)
- Restore each item's `unitCost` to the value recorded in `InventoryWACRunItem.oldUnitCost`
- Clear `wacProcessedAt` and `wacRunId` on all associated POs — they become eligible for the next WAC run
- Set the run status to `REVERSED`

**Reversals require the fiscal period to still be open.** If the period is locked, contact Finance to reopen it first.

---

## Timing — Where to Set the Schedule

### Manual runs (current recommended approach)

Use the Finance UI at `/finance/inventory-costing/wac`. No timing settings needed.

### Automated cron (after Finance validates 3+ manual runs)

The schedule lives in `src/lib/cron/monthly-wac.ts`:

```typescript
// Line ~40 in the MonthlyWACScheduler class:
private schedule = "0 3 1 * *";
//                  │ │ │ │ └─ any weekday
//                  │ │ │ └─── any month
//                  │ │ └───── 1st day of the month
//                  │ └─────── 03:00 AM (server local time)
//                  └───────── minute 0
```

To change it at runtime (no restart needed):

```typescript
import { monthlyWACJob } from '@/lib/cron/monthly-wac';
await monthlyWACJob.updateSchedule('0 4 2 * *'); // 2nd of month at 04:00 AM
```

Valid cron expressions use the `node-cron` format: `minute hour day-of-month month day-of-week`.

### Environment variables — `crn-cron-worker` process only

| Variable | Required | Default | Effect |
|---|---|---|---|
| `MONTHLY_WAC_ENABLED` | No | `false` | `true` enables the scheduled cron job |
| `MONTHLY_WAC_AUTO_POST` | No | `false` | `true` auto-posts after preview (do not set until Finance approves) |

These must be set in the environment of the `crn-cron-worker` PM2 process, not the Next.js app.

---

## Cron Process — How It Fits

The WAC cron job runs inside the **`crn-cron-worker`** PM2 process — the same dedicated Node.js worker that runs all other scheduled jobs (PM scheduler, inventory monitor, reservation review, etc.).

It is **never imported by the Next.js application**. The entry point chain is:

```
PM2 (ecosystem.config.js)
  └── scripts/start-cron-jobs.ts
        └── src/lib/cron/init.ts          ← registers all jobs
              └── src/lib/cron/monthly-wac.ts
                    └── src/services/finance/monthly-wac.service.ts
```

The cron job only runs a **preview** by default. Finance reviews the results in the UI and manually posts. If `MONTHLY_WAC_AUTO_POST=true` is set, the cron will also post automatically — but this should only be enabled after extended manual validation.

---

## Code Map

| Purpose | File |
|---|---|
| **All types — single source of truth** (`WACRunStatus` defined as plain `as const` — no `@prisma/client` import, safe for client components) | `src/services/finance/monthly-wac.types.ts` |
| Calculation and GL posting engine | `src/services/finance/monthly-wac.service.ts` |
| Preview API | `src/app/api/finance/wac/preview/route.ts` |
| Post API | `src/app/api/finance/wac/post/route.ts` |
| Run list API | `src/app/api/finance/wac/runs/route.ts` |
| Run detail API | `src/app/api/finance/wac/runs/[id]/route.ts` |
| Reverse API | `src/app/api/finance/wac/runs/[id]/reverse/route.ts` |
| React hook (mutations + queries) | `src/hooks/finance/use-wac.ts` |
| Hook index registration | `src/hooks/index.ts` |
| **Shared UI helpers** (formatCurrency, status badge, skip reason labels) | `src/app/(dashboard)/finance/inventory-costing/wac/_components/wac-helpers.ts` |
| Finance UI — month picker + run history | `src/app/(dashboard)/finance/inventory-costing/wac/page.tsx` |
| Finance UI — preview + Confirm & Sync | `src/app/(dashboard)/finance/inventory-costing/wac/preview/page.tsx` |
| Finance UI — run detail + reversal | `src/app/(dashboard)/finance/inventory-costing/wac/[id]/page.tsx` |
| Cron job (`crn-cron-worker` only) | `src/lib/cron/monthly-wac.ts` |
| Cron registration | `src/lib/cron/init.ts` |
| Prisma schema | `prisma/schema/wac.prisma` |
| Pre-existing bug fix (qty=1) | `src/services/finance/inventory-revaluation.service.ts` |
| WO cost lock guard | `src/services/work-orders/work-order-cost.service.ts` |

---

## Before Going Live — Checklist

- [ ] Run `npx prisma migrate deploy` in production (adds `inventory_wac_runs`, `inventory_wac_run_items`, WAC fields on `inventory_items` and `purchase_orders`)
- [ ] Notify Finance of the historical revaluation GL error (qty=1 bug) — every past manual revaluation posted the wrong GL amount. Query: `SELECT * FROM gl_transactions WHERE reference_type = 'INVENTORY_REVALUATION'` to identify all affected entries.
- [ ] Finance reviews the WAC page on staging with real data
- [ ] Finance runs a **preview** for a prior closed month and confirms the numbers match expectations
- [ ] Finance runs the first **post** manually
- [ ] Finance verifies the GL entries (DR 1110 / CR 5400 balance)
- [ ] Repeat for two more months
- [ ] Only then: set `MONTHLY_WAC_ENABLED=true` on `crn-cron-worker` if automated scheduling is desired
- [ ] `MONTHLY_WAC_AUTO_POST` stays `false` until Finance explicitly requests automation
