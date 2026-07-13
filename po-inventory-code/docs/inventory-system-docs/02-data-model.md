# Inventory Data Model Reference

Source of truth: `prisma/schema/inventory.prisma` (copied verbatim as `inventory.prisma`).
Related models referenced here live in `cycle-counts.prisma`, `repairables.prisma`,
`suppliers.prisma`, `gl.prisma`, `budgets.prisma`, `wac.prisma`.

All monetary/quantity fields are Postgres `Decimal`. Numeric precision noted where relevant.

---

## Enums

| Enum | Values |
|------|--------|
| `CostChangeSource` | `WAC_RUN`, `WAC_REVERSAL`, `REVALUATION`, `MANUAL`, `IMPORT` |
| `ReservationStatus` | `ACTIVE`, `PENDING_REVIEW`, `PENDING` (backorder/zero-stock), `EXPIRED`, `CANCELLED`, `CONSUMED` |
| `ABCClassification` | `A`, `B`, `C`, `D`, `UNCLASSIFIED` |

Application-level enums (`inventory.types.ts`, not DB enums):
- `TransactionType` → `Purchase | Issue | Adjustment | Return | Transfer` (stored as `String`).
- `InventoryCategory`, `UnitOfMeasure` (display/validation only).

---

## Tables

### `InventoryItem`
The master item record. Key fields:

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `sku` | string, **unique** | |
| `description`, `name`, `category`, `unit` | string | `name` nullable |
| `minQuantity`, `maxQuantity` | Decimal(10,2) | reorder trigger / target |
| `defaultSupplierId` | uuid? | → `Supplier` |
| `unitCost` | Decimal(12,2) | carrying cost (WAC-managed) |
| `equipmentId` | uuid? | → `Equipment` |
| `leadTimeDays` | int? | item-level lead time |
| `isActive`, `isArchived` | bool | `archivedAt/By` on archive |
| `isStockItem` | bool (default true) | stock vs non-stock |
| `isRepairable`, `isAssembly` | bool | |
| `abcClassification` | `ABCClassification?` (default `UNCLASSIFIED`) | |
| `annualUsageQuantity`, `annualUsageValue` | Decimal | drives ABC |
| `cycleCountFrequencyDays`, `lastCycleCountDate`, `nextCycleCountDate` | | cycle-count scheduling |
| `lastWACAt`, `lastWACRunId` | | last WAC run that touched cost |
| `notes`, `longText` | string? | |

Relations: `stock[]`, `transactions[]`, `reservations[]`, `suppliers[]` (`InventoryItemSupplier`),
`poLines[]`, `requisitionLines[]`, `workOrderParts[]`, `directIssues[]`, `repairableItems[]`,
`repairWorkOrders[]`, BOM (`bomLines`, `bomAlternates`, `assemblyBOMEntries`, `componentBOMEntries`),
`usageStatistics[]`, `classificationHistory[]`, `costHistory[]`, `wacRunItems[]`, `costVariances[]`,
`documents[]`, `defaultSupplier`, `equipment`.

### `InventoryCategory`
Simple lookup: `name` (unique), `description`, `isActive`.

### `InventoryStock`
Physical stock per location. **Unique** `(inventoryItemId, storeId, bin)` (default bin `MAIN`).
Fields: `quantityOnHand` (10,2), `quantityReserved` (10,2), `quantityCommitted` (10,4),
`lastCountDate`. → `InventoryItem`, `Store`.

### `Store`
Storeroom. `name` (unique), `code` (unique), `locationId?`, `isActive`.
Relations: `stock[]`, `directIssues[]`, `cycleCountItems[]`, `masterCycleCounts[]`.

### `InventoryTransaction`
Append-only movement ledger.
- Movement: `transactionType` (string), `quantity` (10,2), `unitCost?` (12,2),
  `quantityBefore/After`.
- Reference: `referenceType/Id/Number`, `directIssueId/Number`, `equipmentId/Tag`.
- Actor/audit: `performedBy(Name)`, `createdBy`, `updatedBy`, `transactionDate`.
- Verification: `verified`, `verifiedBy`, `verifiedAt`, `verificationNotes`.
- **Reversal:** `isReversed`, `reversedById`, `reversalOfId` (unique, self-relation
  `TransactionReversal`), `reversalReason`, `reversedBy(Name)`, `reversedAt`.
- `isActive` flag distinguishes live vs voided rows (used throughout aggregation).

### `InventoryReservation`
Soft allocation. `quantity` (10,2), `status` (`ReservationStatus`), `reservedBy`,
`reservedFor` + `reservedForId` (polymorphic consumer), `expiresAt`, lifecycle timestamps
(`cancelled/consumed/confirmed`), `reviewDate`, `reviewNotifiedAt`, `autoReqEnabled`.
**1:1** with `WorkOrderPart`. Has `reviewLogs[]` (`ReservationReviewLog`).

### `ReservationReviewLog`
Audit of reservation reviews: `action`, `previousQty`, `newQty`, `reviewedBy`, `notes`.

### `InventoryItemSupplier`
Per-item supplier records (multi-source). **Unique** `(inventoryItemId, supplierId)`.
Fields: `supplierSku`, `unitCost` (12,2), `leadTimeDays`, `minimumOrderQty`, `isPrimary`,
`isActive`, `lastOrderDate`, `onTimeDeliveries`, `totalDeliveries`, `qualityRating` (3,2).
Cascade-deletes with item and supplier.

### `InventoryUsageStatistic`
Rolling usage aggregates per period. **Unique** `(inventoryItemId, periodStart)`.
Fields: issue/receipt/adjustment counts & quantities, `issueValue`, `averageUnitCost`,
`turnoverRate`.

### `InventoryClassificationHistory`
Immutable ABC history: `previousClassification`, `newClassification`, `annualUsageQuantity/Value`,
`percentileRank`, `classificationRules` (Json), `calculatedBy`.

### `ABCClassificationSettings`
Singleton config: A/B/C percentile thresholds (default 70/90/98), per-class cycle-count
frequencies (`aFrequency`=60 … `dFrequency`=365 days), `rollingMonths` (12), `autoCalculate`,
`calculationDay`.

### `InventoryItemCostHistory`
Immutable `unitCost` change log. `oldUnitCost`/`newUnitCost` (12,4), `changeSource`
(`CostChangeSource`), `referenceId/Type` (WAC run / GL txn), `changedBy(Name)`, `notes`.
Primary index `(inventoryItemId, changedAt)` — used to freeze historical costs in reports.

### `InventoryAutomationRule` / `InventoryAutomationRecommendation`
Rule engine. Rules: `ruleType`, `trigger`, `conditions`/`actions` (Json), `priority`, `isActive`,
`executionCount`, `lastExecutedAt`. Recommendations: `recommendationType`, `impact`,
`estimatedSavings`, `data` (Json), `status` (pending/applied/rejected) with apply/reject audit.

### `InventorySettings` (singleton)
`allowOutsideRepair` (default true), `assemblyTrackingEnabled` (default false), audit fields.

### `ReservationSettings` (singleton)
`mode` (`TIME_BASED` default / `PROMPT_BASED`), `daysThreshold` (30),
`promptOnStockShortage`, `promptOnMinQty`, `autoCreateReq`, audit fields.

---

## Cross-module relations (not in inventory.prisma)
- `MasterCycleCount` / `MasterCycleCountItem` — `cycle-counts.prisma`.
- `RepairableItem`, `RepairableAssemblyBOM`, `EquipmentBOMLine/Alternate` — `repairables.prisma` / equipment.
- `Supplier` — `suppliers.prisma`.
- `POLine`, `RequisitionLine`, `WorkOrderPart`, `DirectIssue` — purchasing/requisitions/work-orders.
- `GLTransaction`, `GLTransactionRule`, budget periods — `gl.prisma`, `budgets.prisma`.
- `InventoryWACRun`, `InventoryWACRunItem`, `CostVariance` — `wac.prisma`.
