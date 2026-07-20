const prisma = require("../config/database");
const {
  generateNumber,
  paginate,
  paginatedResponse,
} = require("../utils/helpers");
const {
  applyStockDelta,
  applyReceiptWac,
  receivedQuantityForLine,
  money,
  qty,
} = require("../services/inventory.service");

// Compute PO money totals from its (open) lines + tax + shipping.
function computeTotals(lines, taxAmount = 0, shippingCost = 0) {
  const subtotal = lines
    .filter((l) => l.lineStatus !== "cancelled")
    .reduce((sum, l) => sum + Number(l.quantity) * Number(l.unitPrice), 0);
  const total = subtotal + Number(taxAmount) + Number(shippingCost);
  return { subtotal: money(subtotal), totalAmount: money(total) };
}

// Roll PO status forward from its lines' received quantities.
function deriveStatus(currentStatus, lines) {
  const open = lines.filter((l) => l.lineStatus !== "cancelled");
  if (open.length === 0) return currentStatus;
  const allReceived = open.every(
    (l) => Number(l.receivedQuantity) >= Number(l.quantity),
  );
  const anyReceived = open.some((l) => Number(l.receivedQuantity) > 0);
  if (allReceived) return "received";
  if (anyReceived) return "partially_received";
  return currentStatus;
}

const list = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const { skip, take } = paginate(page, limit);
    const { status, vendorId, jobId, search } = req.query;

    const where = {};
    if (status) where.status = status;
    if (vendorId) where.vendorId = vendorId;
    if (jobId) where.jobId = jobId;
    if (search) where.poNumber = { contains: search, mode: "insensitive" };

    const [orders, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        skip,
        take,
        orderBy: { orderDate: "desc" },
        include: {
          vendor: { select: { id: true, name: true } },
          shipToLocation: { select: { id: true, name: true, code: true } },
          job: { select: { id: true, jobNumber: true, summary: true } },
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              companyName: true,
            },
          },
          _count: { select: { lines: true } },
        },
      }),
      prisma.purchaseOrder.count({ where }),
    ]);

    return res.json({
      success: true,
      ...paginatedResponse(orders, total, page, limit),
    });
  } catch (err) {
    console.error("purchasing.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const get = async (req, res) => {
  try {
    const order = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: {
        vendor: true,
        shipToLocation: { select: { id: true, name: true, code: true } },
        job: { select: { id: true, jobNumber: true, summary: true } },
        customer: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            companyName: true,
          },
        },
        lines: {
          orderBy: { lineNumber: "asc" },
          include: {
            inventoryItem: {
              select: { id: true, sku: true, name: true, unit: true },
            },
            receipts: {
              orderBy: { receivedAt: "desc" },
              include: {
                stockLocation: { select: { id: true, name: true, code: true } },
              },
            },
          },
        },
      },
    });
    if (!order)
      return res
        .status(404)
        .json({ success: false, error: "Purchase order not found" });
    return res.json({ success: true, data: order });
  } catch (err) {
    console.error("purchasing.get error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const create = async (req, res) => {
  try {
    const {
      vendorId,
      shipToLocationId,
      jobId,
      customerId,
      expectedDate,
      deliveryTerms,
      notes,
      taxAmount = 0,
      shippingCost = 0,
      lines = [],
    } = req.body;

    if (!vendorId)
      return res
        .status(400)
        .json({ success: false, error: "vendorId is required" });
    if (!Array.isArray(lines) || lines.length === 0)
      return res
        .status(400)
        .json({ success: false, error: "At least one line is required" });

    const settings = await prisma.companySettings.findFirst();
    if (!settings)
      return res
        .status(500)
        .json({ success: false, error: "Company settings not found" });

    const poNumber = generateNumber(settings.poPrefix, settings.nextPoNumber);
    const { subtotal, totalAmount } = computeTotals(
      lines,
      taxAmount,
      shippingCost,
    );

    const order = await prisma.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: {
          poNumber,
          vendorId,
          shipToLocationId: shipToLocationId || null,
          jobId: jobId || null,
          customerId: customerId || null,
          expectedDate: expectedDate ? new Date(expectedDate) : null,
          deliveryTerms: deliveryTerms || null,
          notes: notes || null,
          taxAmount: money(taxAmount),
          shippingCost: money(shippingCost),
          subtotal,
          totalAmount,
          createdById: req.user?.id || null,
          lines: {
            create: lines.map((l, idx) => ({
              inventoryItemId: l.inventoryItemId || null,
              lineType: l.lineType || "inventory",
              lineNumber: idx + 1,
              description: l.description,
              quantity: qty(l.quantity),
              unitPrice: money(l.unitPrice),
              totalPrice: money(Number(l.quantity) * Number(l.unitPrice)),
              notes: l.notes || null,
            })),
          },
        },
        include: {
          lines: true,
          vendor: { select: { id: true, name: true } },
        },
      });
      await tx.companySettings.update({
        where: { id: settings.id },
        data: { nextPoNumber: { increment: 1 } },
      });
      return created;
    });

    return res.status(201).json({ success: true, data: order });
  } catch (err) {
    console.error("purchasing.create error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Header-only update; line editing only while the PO is still a draft.
const update = async (req, res) => {
  try {
    const existing = await prisma.purchaseOrder.findUnique({
      where: { id: req.params.id },
      include: { lines: true },
    });
    if (!existing)
      return res
        .status(404)
        .json({ success: false, error: "Purchase order not found" });

    const {
      shipToLocationId,
      jobId,
      customerId,
      expectedDate,
      deliveryTerms,
      notes,
      taxAmount,
      shippingCost,
      lines,
    } = req.body;

    const data = {
      ...(shipToLocationId !== undefined && {
        shipToLocationId: shipToLocationId || null,
      }),
      ...(jobId !== undefined && { jobId: jobId || null }),
      ...(customerId !== undefined && { customerId: customerId || null }),
      ...(expectedDate !== undefined && {
        expectedDate: expectedDate ? new Date(expectedDate) : null,
      }),
      ...(deliveryTerms !== undefined && {
        deliveryTerms: deliveryTerms || null,
      }),
      ...(notes !== undefined && { notes: notes || null }),
      ...(taxAmount !== undefined && { taxAmount: money(taxAmount) }),
      ...(shippingCost !== undefined && { shippingCost: money(shippingCost) }),
    };

    // Replace lines only if provided AND the PO is still a draft.
    const replaceLines = Array.isArray(lines);
    if (replaceLines && existing.status !== "draft") {
      return res.status(400).json({
        success: false,
        error: "Lines can only be edited while the PO is a draft",
      });
    }

    const order = await prisma.$transaction(async (tx) => {
      if (replaceLines) {
        await tx.pOLine.deleteMany({ where: { purchaseOrderId: existing.id } });
        await tx.pOLine.createMany({
          data: lines.map((l, idx) => ({
            purchaseOrderId: existing.id,
            inventoryItemId: l.inventoryItemId || null,
            lineType: l.lineType || "inventory",
            lineNumber: idx + 1,
            description: l.description,
            quantity: qty(l.quantity),
            unitPrice: money(l.unitPrice),
            totalPrice: money(Number(l.quantity) * Number(l.unitPrice)),
            notes: l.notes || null,
          })),
        });
      }

      const effectiveLines = replaceLines ? lines : existing.lines;
      const tax = data.taxAmount ?? existing.taxAmount;
      const ship = data.shippingCost ?? existing.shippingCost;
      const { subtotal, totalAmount } = computeTotals(
        effectiveLines,
        tax,
        ship,
      );

      return tx.purchaseOrder.update({
        where: { id: existing.id },
        data: { ...data, subtotal, totalAmount },
        include: {
          lines: { orderBy: { lineNumber: "asc" } },
          vendor: { select: { id: true, name: true } },
        },
      });
    });

    return res.json({ success: true, data: order });
  } catch (err) {
    console.error("purchasing.update error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// Status transitions: draft → ordered (send/approve) → ... ; also cancel / close.
const setStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["draft", "ordered", "closed", "cancelled"];
    if (!allowed.includes(status))
      return res.status(400).json({
        success: false,
        error: `status must be one of: ${allowed.join(", ")}`,
      });

    const data = { status };
    if (status === "ordered") {
      data.approvedAt = new Date();
      data.sentAt = new Date();
    }
    if (status === "closed") data.closedAt = new Date();
    if (status === "cancelled") {
      data.cancelledAt = new Date();
      if (req.body.cancelledReason)
        data.cancelledReason = req.body.cancelledReason;
    }

    const order = await prisma.purchaseOrder.update({
      where: { id: req.params.id },
      data,
    });
    return res.json({ success: true, data: order });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Purchase order not found" });
    console.error("purchasing.setStatus error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

/**
 * Receive goods against a PO. Body:
 *   { items: [{ lineId, quantityReceived, stockLocationId, unitCost?,
 *               serialNumbers?, lotNumber?, documentNumber?, notes? }] }
 *
 * For each INVENTORY line: recompute perpetual WAC (pre-add), add stock to the
 * chosen location, mint serialized units if provided, then self-heal the line's
 * receivedQuantity from active receipts and roll the PO status forward.
 */
const receiveItems = async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (items.length === 0)
      return res
        .status(400)
        .json({ success: false, error: "No items to receive" });

    const result = await prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({
        where: { id: req.params.id },
        include: { lines: true },
      });
      if (!po) {
        const e = new Error("Purchase order not found");
        e.status = 404;
        throw e;
      }
      if (po.status === "cancelled") {
        const e = new Error("Cannot receive against a cancelled PO");
        e.status = 400;
        throw e;
      }

      const settings = await tx.companySettings.findFirst();
      let nextReceipt = settings.nextReceiptNumber;

      for (const rec of items) {
        const line = po.lines.find((l) => l.id === rec.lineId);
        if (!line || line.lineStatus === "cancelled") {
          const e = new Error(`Invalid or cancelled line: ${rec.lineId}`);
          e.status = 400;
          throw e;
        }
        const q = Number(rec.quantityReceived);
        if (!(q > 0)) {
          const e = new Error("quantityReceived must be greater than 0");
          e.status = 400;
          throw e;
        }
        if (line.lineType === "inventory" && !rec.stockLocationId) {
          const e = new Error(
            "stockLocationId is required for inventory lines",
          );
          e.status = 400;
          throw e;
        }

        // Self-heal received qty from receipts before the over-receive check.
        const already = await receivedQuantityForLine(tx, line.id);
        if (already + q > Number(line.quantity)) {
          const e = new Error(
            `Over-receipt on line "${line.description}": ${already + q} > ordered ${line.quantity}`,
          );
          e.status = 400;
          throw e;
        }

        const unitCost =
          rec.unitCost !== null && rec.unitCost !== undefined
            ? Number(rec.unitCost)
            : Number(line.unitPrice);

        if (line.lineType === "inventory" && line.inventoryItemId) {
          await applyReceiptWac(tx, {
            itemId: line.inventoryItemId,
            receiptQty: q,
            receiptUnitCost: unitCost,
            vendorId: po.vendorId,
            referenceType: "purchase_order",
            referenceId: po.id,
            performedBy: req.user?.id,
          });
          await applyStockDelta(tx, {
            itemId: line.inventoryItemId,
            locationId: rec.stockLocationId,
            delta: q,
            type: "receipt",
            unitCost,
            referenceType: "purchase_order",
            referenceId: po.id,
            referenceNumber: po.poNumber,
            performedBy: req.user?.id,
          });
        }

        const receiptNumber = generateNumber(
          settings.receiptPrefix,
          nextReceipt,
        );
        nextReceipt += 1;

        const serialNumbers = Array.isArray(rec.serialNumbers)
          ? rec.serialNumbers.filter(Boolean)
          : [];

        const receipt = await tx.pOLineReceipt.create({
          data: {
            poLineId: line.id,
            receiptNumber,
            quantityReceived: qty(q),
            unitCost: money(unitCost),
            totalCost: money(q * unitCost),
            stockLocationId: rec.stockLocationId || null,
            receivedById: req.user?.id || null,
            status: "active",
            documentNumber: rec.documentNumber || null,
            lotNumber: rec.lotNumber || null,
            serialNumbers,
            notes: rec.notes || null,
          },
        });

        // Mint serialized units for serialized inventory lines.
        if (
          line.lineType === "inventory" &&
          line.inventoryItemId &&
          serialNumbers.length
        ) {
          for (const sn of serialNumbers) {
            await tx.serializedUnit.create({
              data: {
                serialNumber: sn,
                inventoryItemId: line.inventoryItemId,
                status: "in_stock",
                stockLocationId: rec.stockLocationId || null,
                sourceReceiptId: receipt.id,
                purchaseCost: money(unitCost),
              },
            });
          }
        }

        const newReceived = await receivedQuantityForLine(tx, line.id);
        await tx.pOLine.update({
          where: { id: line.id },
          data: { receivedQuantity: newReceived },
        });
        line.receivedQuantity = newReceived; // keep local copy fresh for status calc
      }

      await tx.companySettings.update({
        where: { id: settings.id },
        data: { nextReceiptNumber: nextReceipt },
      });

      const freshLines = await tx.pOLine.findMany({
        where: { purchaseOrderId: po.id },
      });
      const status = deriveStatus(po.status, freshLines);
      const allReceived = status === "received";

      await tx.purchaseOrder.update({
        where: { id: po.id },
        data: {
          status,
          ...(allReceived && { receivedDate: new Date() }),
        },
      });

      return tx.purchaseOrder.findUnique({
        where: { id: po.id },
        include: {
          vendor: { select: { id: true, name: true } },
          lines: {
            orderBy: { lineNumber: "asc" },
            include: { receipts: true },
          },
        },
      });
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    if (err.status)
      return res
        .status(err.status)
        .json({ success: false, error: err.message });
    if (err.code === "P2002")
      return res.status(409).json({
        success: false,
        error: "A serial number already exists for this item",
      });
    console.error("purchasing.receiveItems error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

/**
 * Reverse a receipt: mark it REVERSED, move the stock back out of the same
 * location, void any still-in-stock serials it created, self-heal the line, and
 * reopen the PO status. (Cost is not un-averaged — WAC is path-dependent; the
 * reversing stock movement is recorded at the receipt's unit cost.)
 */
const reverseReceipt = async (req, res) => {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const receipt = await tx.pOLineReceipt.findUnique({
        where: { id: req.params.receiptId },
        include: { poLine: { include: { purchaseOrder: true } } },
      });
      if (!receipt || receipt.poLine.purchaseOrderId !== req.params.id) {
        const e = new Error("Receipt not found");
        e.status = 404;
        throw e;
      }
      if (receipt.status !== "active") {
        const e = new Error("Only active receipts can be reversed");
        e.status = 400;
        throw e;
      }

      const line = receipt.poLine;

      if (
        line.lineType === "inventory" &&
        line.inventoryItemId &&
        receipt.stockLocationId
      ) {
        await applyStockDelta(tx, {
          itemId: line.inventoryItemId,
          locationId: receipt.stockLocationId,
          delta: -Number(receipt.quantityReceived),
          type: "reversal",
          unitCost: Number(receipt.unitCost),
          referenceType: "receipt_reversal",
          referenceId: receipt.id,
          referenceNumber: receipt.receiptNumber,
          notes: req.body.reason || null,
          performedBy: req.user?.id,
        });
      }

      // Void serials this receipt created that are still on hand.
      await tx.serializedUnit.deleteMany({
        where: { sourceReceiptId: receipt.id, status: "in_stock" },
      });

      await tx.pOLineReceipt.update({
        where: { id: receipt.id },
        data: { status: "reversed", notes: req.body.reason || receipt.notes },
      });

      const newReceived = await receivedQuantityForLine(tx, line.id);
      await tx.pOLine.update({
        where: { id: line.id },
        data: { receivedQuantity: newReceived },
      });

      const freshLines = await tx.pOLine.findMany({
        where: { purchaseOrderId: line.purchaseOrderId },
      });
      const anyReceived = freshLines.some(
        (l) => Number(l.receivedQuantity) > 0,
      );
      const allReceived = freshLines
        .filter((l) => l.lineStatus !== "cancelled")
        .every((l) => Number(l.receivedQuantity) >= Number(l.quantity));
      const status = allReceived
        ? "received"
        : anyReceived
          ? "partially_received"
          : "ordered";

      await tx.purchaseOrder.update({
        where: { id: line.purchaseOrderId },
        data: { status },
      });

      return tx.pOLineReceipt.findUnique({ where: { id: receipt.id } });
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    if (err.status)
      return res
        .status(err.status)
        .json({ success: false, error: err.message });
    console.error("purchasing.reverseReceipt error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

/**
 * Items at/below their reorder point, grouped by default vendor, with a
 * suggested order quantity and the best-known cost (primary vendor catalog
 * price, falling back to the item's average cost).
 */
const reorderSuggestions = async (req, res) => {
  try {
    const items = await prisma.inventoryItem.findMany({
      where: { isArchived: false, isActive: true, isStockItem: true },
      include: {
        stock: true,
        defaultVendor: { select: { id: true, name: true } },
        vendors: {
          where: { isActive: true },
          orderBy: { isPrimary: "desc" },
          take: 1,
          include: { vendor: { select: { id: true, name: true } } },
        },
      },
    });

    const low = items
      .map((item) => {
        const onHand = qty(
          item.stock.reduce((sum, s) => sum + Number(s.quantityOnHand), 0),
        );
        return { item, onHand };
      })
      .filter(
        ({ item, onHand }) =>
          Number(item.reorderPoint) > 0 && onHand <= Number(item.reorderPoint),
      );

    const groups = new Map();
    for (const { item, onHand } of low) {
      const catalog = item.vendors[0] ?? null;
      const vendor = catalog?.vendor ?? item.defaultVendor ?? null;
      const key = vendor?.id ?? "unassigned";
      if (!groups.has(key)) {
        groups.set(key, {
          vendor: vendor ?? { id: null, name: "No vendor assigned" },
          lines: [],
        });
      }
      const reorderQty = Number(item.reorderQuantity);
      const maxQty = Number(item.maxQuantity);
      const suggestedQuantity =
        reorderQty > 0
          ? reorderQty
          : Math.max(1, qty(maxQty > 0 ? maxQty - onHand : 1));
      groups.get(key).lines.push({
        inventoryItemId: item.id,
        sku: item.sku,
        name: item.name,
        onHand,
        reorderPoint: Number(item.reorderPoint),
        suggestedQuantity,
        unitCost: Number(catalog ? catalog.unitCost : item.unitCost),
      });
    }

    return res.json({ success: true, data: Array.from(groups.values()) });
  } catch (err) {
    console.error("purchasing.reorderSuggestions error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = {
  list,
  get,
  create,
  update,
  setStatus,
  receiveItems,
  reverseReceipt,
  reorderSuggestions,
};
