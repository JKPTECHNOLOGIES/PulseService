/**
 * Core inventory movement + costing service.
 *
 * All stock changes go through here so that:
 *   - InventoryStock (per-location on-hand) stays consistent,
 *   - every movement writes an append-only InventoryTransaction (with
 *     before/after snapshots),
 *   - receipts drive a PERPETUAL weighted-average cost (WAC) on the item,
 *     recomputed at the moment goods are received and journaled to
 *     InventoryItemCostHistory.
 *
 * Functions accept a Prisma client (`client`) so callers can pass either the
 * root client or a `$transaction` client to keep operations atomic.
 */

// Rounding helpers — costs to 4dp, quantities to 2dp (matches the schema).
function round(n, dp) {
  const f = 10 ** dp;
  return Math.round((Number(n) + Number.EPSILON) * f) / f;
}
const money = (n) => round(n, 4);
const qty = (n) => round(n, 2);

function httpError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/** Total on-hand for an item across every stock location. */
async function totalOnHand(client, itemId) {
  const agg = await client.inventoryStock.aggregate({
    where: { inventoryItemId: itemId },
    _sum: { quantityOnHand: true },
  });
  return Number(agg._sum.quantityOnHand ?? 0);
}

/**
 * Apply a signed quantity delta to a single (item, location) stock row and
 * record the movement. Negative results are rejected.
 * Returns `{ stock, transaction }`.
 */
async function applyStockDelta(
  client,
  {
    itemId,
    locationId,
    delta,
    type,
    unitCost = null,
    referenceType = null,
    referenceId = null,
    referenceNumber = null,
    jobId = null,
    notes = null,
    performedBy = null,
  },
) {
  const existing = await client.inventoryStock.findUnique({
    where: {
      inventoryItemId_stockLocationId: {
        inventoryItemId: itemId,
        stockLocationId: locationId,
      },
    },
  });

  const before = Number(existing?.quantityOnHand ?? 0);
  const after = qty(before + Number(delta));
  if (after < 0) {
    throw httpError("Insufficient stock at the selected location", 400);
  }

  const stock = existing
    ? await client.inventoryStock.update({
        where: { id: existing.id },
        data: { quantityOnHand: after },
      })
    : await client.inventoryStock.create({
        data: {
          inventoryItemId: itemId,
          stockLocationId: locationId,
          quantityOnHand: after,
        },
      });

  const transaction = await client.inventoryTransaction.create({
    data: {
      inventoryItemId: itemId,
      stockLocationId: locationId,
      type,
      quantity: qty(delta),
      unitCost:
        unitCost !== null && unitCost !== undefined ? money(unitCost) : null,
      quantityBefore: qty(before),
      quantityAfter: after,
      referenceType,
      referenceId,
      referenceNumber,
      jobId,
      notes,
      performedBy,
    },
  });

  return { stock, transaction };
}

/**
 * Perpetual weighted-average cost. Call this BEFORE the received quantity is
 * added to stock, so `currentQty` reflects the pre-receipt on-hand:
 *
 *   newWAC = (currentQty * currentCost + receiptQty * receiptCost)
 *            / (currentQty + receiptQty)
 *
 * Updates InventoryItem.unitCost and logs InventoryItemCostHistory when the
 * cost actually changes. Returns the new unit cost.
 */
async function applyReceiptWac(
  client,
  {
    itemId,
    receiptQty,
    receiptUnitCost,
    supplierId = null,
    referenceType = null,
    referenceId = null,
    performedBy = null,
  },
) {
  const item = await client.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) throw httpError("Inventory item not found", 404);

  const currentQty = await totalOnHand(client, itemId);
  const currentCost = Number(item.unitCost);
  const rq = Number(receiptQty);
  const rc = Number(receiptUnitCost);

  const denom = currentQty + rq;
  // If there was no prior stock (or a net-zero base) the receipt cost becomes
  // the new average outright.
  const newCost =
    denom > 0 ? money((currentQty * currentCost + rq * rc) / denom) : money(rc);

  if (money(newCost) !== money(currentCost)) {
    await client.inventoryItem.update({
      where: { id: itemId },
      data: { unitCost: newCost },
    });
    await client.inventoryItemCostHistory.create({
      data: {
        inventoryItemId: itemId,
        oldUnitCost: money(currentCost),
        newUnitCost: newCost,
        changeSource: "receipt",
        quantityOnHand: qty(currentQty),
        receiptQuantity: qty(rq),
        receiptUnitCost: money(rc),
        supplierId,
        referenceType,
        referenceId,
        performedBy,
      },
    });
  }

  return newCost;
}

/** Sum of ACTIVE, non-return receipt quantity for a PO line (self-heal source). */
async function receivedQuantityForLine(client, lineId) {
  const agg = await client.pOLineReceipt.aggregate({
    where: { poLineId: lineId, status: "active", isReturn: false },
    _sum: { quantityReceived: true },
  });
  return qty(Number(agg._sum.quantityReceived ?? 0));
}

module.exports = {
  money,
  qty,
  httpError,
  totalOnHand,
  applyStockDelta,
  applyReceiptWac,
  receivedQuantityForLine,
};
