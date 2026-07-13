# Purchase Order Data Model Reference

Source of truth: `prisma/schema/purchasing.prisma` (copied verbatim as `purchasing.prisma`).
Upstream requisitions: `requisitions.prisma`. Related: `inventory.prisma` (stock/items),
`gl.prisma`, `budgets.prisma`, `suppliers.prisma`, `invoicing.prisma`.

Money/quantity fields are Postgres `Decimal`. Prices use `Decimal(18,6)`; quantities `Decimal(10,2)`.

---

## Enums

| Enum | Values |
|------|--------|
| `PurchaseOrderStatus` (string on `PurchaseOrder.status`) | `Draft`, `Submitted`, `Approved`, `Ordered`, `PartiallyReceived`, `Received`, `Invoiced`, `Closed`, `Cancelled` |
| `LineItemType` | `INVENTORY`, `SERVICE`, `CONSUMABLE`, `NON_STOCK`, `REPAIRABLE_RETURN` |
| `POLineStatus` | `OPEN`, `CANCELLED` |
| `POLineCancellationType` | `REPAIRABLE_SCRAP`, `MANUAL` |
| `ReceiptStatus` | `ACTIVE`, `REVERSED`, `VOIDED` |
| `RMAStatus` | `DRAFT`, `SUBMITTED`, … |
| `RMAReturnType` | `DEFECTIVE`, `WRONG_ITEM`, … |
| `ReturnCondition` | `GOOD`, `DAMAGED`, … |
| `ReturnDisposition` | `RESTOCK`, `SCRAP`, … |

---

## `PurchaseOrder` (header)
Key fields:

| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `poNumber` | string, **unique** | from `DocumentCounter` |
| `supplierId` | uuid | → `Supplier` |
| `status` | string | one of `PurchaseOrderStatus` |
| `orderDate`, `expectedDate`, `receivedDate` | DateTime | |
| `sentAt`, `submittedAt`, `approvedAt`, `closedAt` | DateTime? | lifecycle stamps |
| `totalAmount`, `approvedTotal` | Decimal(18,6) | approved* = snapshot at approval |
| `taxAmount`, `shippingCost` | Decimal(18,6) | default 0 |
| `paymentTermsOverride` | string? | overrides supplier terms |
| `buyerId`, `invoiceApproverId`, `createdBy` | uuid? | → `User` |
| `requisitionIds/Numbers[]`, `workOrderIds/Numbers[]` | string[] | back-links |
| vendor snapshot | `vendorName`, `vendorAddress1/2`, `vendorCity/State/Zip/Country` | frozen at creation |
| ship-to override | `shipToName/Attention/Address1/2/City/State/Zip/Country` | null → falls back to company address |
| `supersededByPOId/Number` | | PO supersession chain |
| `wacProcessedAt`, `wacRunId` | | costing (can omit in target) |

Relations: `lines[]` (`POLine`), `invoices[]`, `returns[]`, `documents[]`, `supplier`, `creator`,
`buyer`, `invoiceApprover`, `supplierAddress`, `supersedes/supersededBy`, `requisitionLines[]`.

## `POLine` (ordered item)
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `purchaseOrderId` | uuid | → PO (cascade delete) |
| `inventoryItemId` | uuid? | set for INVENTORY/CONSUMABLE lines |
| `lineNumber` | int | |
| `description` | string | |
| `quantity` | Decimal(10,2) | |
| `unitPrice`, `totalPrice` | Decimal(18,6) | |
| `approvedUnitPrice`, `approvedTotalPrice` | Decimal(18,6)? | snapshot at approval |
| `receivedQuantity` | Decimal(10,2) | **denormalized cache** of ACTIVE receipts |
| `lineType` | `LineItemType` | drives receiving path |
| `unitOfMeasure` | string? | |
| `deliveryDate` | DateTime? | |
| requisition back-links | `requisitionId/LineId/Number` | |
| work-order back-links | `workOrderId/Number` | |
| SERVICE fields | `serviceType`, `serviceProvider`, `hourlyRate`, `estimatedHours`, `contractNumber`, `serviceStart/EndDate`, `slaDetails`, … | |
| CONSUMABLE fields | `consumableCategory`, `packageSize`, `sdsRequired`, `expirationTracking`, `monthlyUsageRate`, `storageRequirements`, … | |
| invoice-match | `requiresInvoiceMatch`, `invoiceMatched`, `canReceive` | true for SERVICE |
| dollar tracking | `approvedInvoiceAmount`, `receivedAmount` (18,6) | drives SERVICE receive form |
| line cancellation | `lineStatus` (`OPEN`/`CANCELLED`), `cancelledAt/By/Reason`, `cancellationType` | CANCELLED lines excluded from totals/receiving |
| repairable | `repairableItemId`, `replacesRepairableItemId` | for REPAIRABLE_RETURN / scrap-and-replace |

Relations: `inventoryItem`, `purchaseOrder`, `chargeAllocations[]`, `receipts[]`, `returns[]`,
`invoiceLineItems[]`, `requisition`, `requisitionLines[]`, `workOrder`, `repairableItem`.

## `POLineReceipt` (receiving event) — table `po_line_receipts`
| Field | Type | Notes |
|-------|------|-------|
| `id` | uuid PK | |
| `poLineId` | uuid | → POLine (cascade) |
| `receiptNumber` | string, **unique** | `RCT-YYYYMM-<seq>` |
| `quantityReceived` | Decimal(10,2) | |
| `unitCost`, `totalCost` | Decimal(18,6) | |
| `receivedBy`, `receivedByName` | | → `User` |
| `receivedAt` | DateTime | |
| **`storeId`** | string? | **destination location — the warehouse or a truck** |
| `bin` | string? | optional; defaults to `MAIN` (droppable for target system) |
| `lotNumber` | string? | |
| `serialNumbers` | string[] | |
| `documentNumber` | string? | packing slip / receiving number |
| `status` | `ReceiptStatus` | `ACTIVE` / `REVERSED` / `VOIDED` |
| `isReturn`, `originalReceiptId` | | returns/corrections linkage |
| `invoiceId`, `invoiceNumber`, `invoiceDate` | | invoice linkage (can omit in target) |
| `wacProcessedAt`, `wacRunId` | | costing (can omit) |
| `tabwareSettledAt*` | | legacy-migration flags (source-plant specific; drop) |

Relations: `poLine`, `receiver`, `invoice`, `serviceReceipts[]`, `consumableUsages[]`,
`returns[]`, `originalReceipt`/`returnReceipts`, `autoGeneratedSerials[]`, `wacRun`.

## `ServiceReceipt` (per SERVICE receipt)
`serviceDate`, `serviceProvider`, `hoursOrUnits`, `completionNotes`, `qualityRating`.

## `ConsumableUsage` (per CONSUMABLE receipt)
`usedBy(Name)`, `usedAt`, `departmentId`, `areaId`, `purpose`, `notes`.

## RMA (return to vendor) — optional
`PurchaseOrderReturn` (`rmaNumber` unique, `returnType`, `status`, approval workflow),
`POLineReturn` (per-line return quantities/conditions), `RMAApprovalHistory`.

## `DocumentCounter`
`name` (PK, e.g. "PO", "REQ", "RECEIPT"), `nextValue`. Atomic increment → race-free numbering.

---

## Cross-module (not in purchasing.prisma)
- `InventoryItem`, `InventoryStock`, `InventoryTransaction`, `Store` — `inventory.prisma`.
- `Supplier`, `SupplierAddress` — `suppliers.prisma`.
- `Requisition`, `RequisitionLine`, approval models — `requisitions.prisma`.
- `Invoice`, `InvoiceLineItem` — `invoicing.prisma`.
- `GLTransaction`, `GLTransactionRule`, `POLineChargeAllocation`, budget periods — `gl.prisma` / `budgets.prisma`.
