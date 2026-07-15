const prisma = require("../config/database");
const permissionsService = require("../services/permissions.service");
const {
  paginate,
  paginatedResponse,
  generateNumber,
} = require("../utils/helpers");
const {
  applyStockDelta,
  qty,
  money,
} = require("../services/inventory.service");

// Sum on-hand across every location for a loaded item (item.stock included).
function totalFromStock(stock = []) {
  return qty(stock.reduce((sum, s) => sum + Number(s.quantityOnHand), 0));
}

// Read-only endpoints in this file are intentionally left open to any
// authenticated user (e.g. AddPartModal needs the item list to let a
// technician pick a part), but wholesale cost is not something everyone who
// can browse that list should see. Strip it out unless the caller actually
// holds inventory.manage.
async function canSeeCost(req) {
  const granted = await permissionsService.getForRole(req.user.role);
  return granted.includes("inventory.manage");
}
function omitCost(item) {
  const { unitCost: _unitCost, ...rest } = item;
  return rest;
}

// ─── Items (catalog) ─────────────────────────────────────────────────────────

const list = async (req, res) => {
  try {
    const { search, categoryId, vendorId, locationId, lowStock } = req.query;

    const where = { isArchived: false };
    if (categoryId) where.categoryId = categoryId;
    if (vendorId) where.defaultVendorId = vendorId;
    if (locationId) where.stock = { some: { stockLocationId: locationId } };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    const items = await prisma.inventoryItem.findMany({
      where,
      include: {
        stock: {
          include: {
            stockLocation: {
              select: { id: true, name: true, code: true, type: true },
            },
          },
        },
        defaultVendor: { select: { id: true, name: true } },
        pricebookItem: { select: { id: true, name: true, unitPrice: true } },
      },
      orderBy: { name: "asc" },
    });

    const canSeeCostValue = await canSeeCost(req);
    const result = items.map((item) => {
      const totalOnHand = totalFromStock(item.stock);
      const shaped = canSeeCostValue ? item : omitCost(item);
      return {
        ...shaped,
        totalOnHand,
        isLowStock: totalOnHand <= Number(item.reorderPoint),
      };
    });

    const filtered =
      lowStock === "true" ? result.filter((i) => i.isLowStock) : result;

    return res.json({ success: true, data: filtered });
  } catch (err) {
    console.error("inventory.list error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const get = async (req, res) => {
  try {
    const item = await prisma.inventoryItem.findUnique({
      where: { id: req.params.id },
      include: {
        stock: {
          include: {
            stockLocation: {
              select: { id: true, name: true, code: true, type: true },
            },
          },
        },
        defaultVendor: { select: { id: true, name: true } },
        pricebookItem: true,
        vendors: {
          include: { vendor: { select: { id: true, name: true } } },
        },
        transactions: {
          orderBy: { transactionDate: "desc" },
          take: 20,
          include: {
            stockLocation: { select: { id: true, name: true, code: true } },
          },
        },
        costHistory: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });

    if (!item)
      return res.status(404).json({ success: false, error: "Item not found" });

    const totalOnHand = totalFromStock(item.stock);
    return res.json({
      success: true,
      data: {
        ...item,
        totalOnHand,
        isLowStock: totalOnHand <= Number(item.reorderPoint),
      },
    });
  } catch (err) {
    console.error("inventory.get error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const create = async (req, res) => {
  try {
    // Optional initial stock: { stockLocationId, quantityOnHand }
    const { initialStock, ...data } = req.body;

    const item = await prisma.inventoryItem.create({
      data: {
        ...data,
        ...(initialStock?.stockLocationId
          ? {
              stock: {
                create: {
                  stockLocationId: initialStock.stockLocationId,
                  quantityOnHand: qty(initialStock.quantityOnHand ?? 0),
                },
              },
            }
          : {}),
      },
      include: { stock: true },
    });
    return res.status(201).json({ success: true, data: item });
  } catch (err) {
    if (err.code === "P2002")
      return res
        .status(409)
        .json({ success: false, error: "SKU already exists" });
    console.error("inventory.create error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const update = async (req, res) => {
  try {
    // unitCost is WAC-managed; never accept it from a plain item edit.
    const {
      id: _id,
      unitCost: _uc,
      stock: _s,
      totalOnHand: _t,
      isLowStock: _l,
      createdAt: _ca,
      updatedAt: _ua,
      ...data
    } = req.body;
    const item = await prisma.inventoryItem.update({
      where: { id: req.params.id },
      data,
    });
    return res.json({ success: true, data: item });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ success: false, error: "Item not found" });
    if (err.code === "P2002")
      return res
        .status(409)
        .json({ success: false, error: "SKU already exists" });
    console.error("inventory.update error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const remove = async (req, res) => {
  try {
    await prisma.inventoryItem.update({
      where: { id: req.params.id },
      data: { isArchived: true, archivedAt: new Date(), isActive: false },
    });
    return res.json({ success: true, message: "Item archived" });
  } catch (err) {
    if (err.code === "P2025")
      return res.status(404).json({ success: false, error: "Item not found" });
    console.error("inventory.remove error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ─── Stock movements ─────────────────────────────────────────────────────────

/**
 * Adjust stock at a single location.
 *   type "add"    → increase by |quantity|
 *   type "remove" → decrease by |quantity|
 *   type "set"    → set on-hand to exactly `quantity` (records the delta)
 */
const adjust = async (req, res) => {
  try {
    const { stockLocationId, quantity, type = "add", notes } = req.body;
    if (!stockLocationId)
      return res
        .status(400)
        .json({ success: false, error: "stockLocationId is required" });
    if (quantity === undefined || Number.isNaN(Number(quantity)))
      return res
        .status(400)
        .json({ success: false, error: "quantity must be a number" });

    const item = await prisma.inventoryItem.findUnique({
      where: { id: req.params.id },
    });
    if (!item)
      return res.status(404).json({ success: false, error: "Item not found" });

    const value = Math.abs(Number(quantity));
    let delta;
    let txnType = "adjustment";
    if (type === "remove") {
      delta = -value;
      txnType = "issue";
    } else if (type === "set") {
      const current = await prisma.inventoryStock.findUnique({
        where: {
          inventoryItemId_stockLocationId: {
            inventoryItemId: req.params.id,
            stockLocationId,
          },
        },
      });
      delta = Number(quantity) - Number(current?.quantityOnHand ?? 0);
      txnType = "count";
    } else {
      delta = value;
      txnType = "adjustment";
    }

    const { stock } = await prisma.$transaction((tx) =>
      applyStockDelta(tx, {
        itemId: req.params.id,
        locationId: stockLocationId,
        delta,
        type: txnType,
        notes,
        performedBy: req.user?.id,
      }),
    );

    return res.json({ success: true, data: stock });
  } catch (err) {
    if (err.status)
      return res
        .status(err.status)
        .json({ success: false, error: err.message });
    console.error("inventory.adjust error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

/** Move stock from one location to another (e.g. warehouse → truck). */
const transfer = async (req, res) => {
  try {
    const { fromLocationId, toLocationId, quantity, notes } = req.body;
    const amount = Number(quantity);
    if (!fromLocationId || !toLocationId)
      return res.status(400).json({
        success: false,
        error: "fromLocationId and toLocationId are required",
      });
    if (fromLocationId === toLocationId)
      return res
        .status(400)
        .json({ success: false, error: "Source and destination must differ" });
    if (!(amount > 0))
      return res
        .status(400)
        .json({ success: false, error: "quantity must be greater than 0" });

    const item = await prisma.inventoryItem.findUnique({
      where: { id: req.params.id },
    });
    if (!item)
      return res.status(404).json({ success: false, error: "Item not found" });

    const result = await prisma.$transaction(async (tx) => {
      const out = await applyStockDelta(tx, {
        itemId: req.params.id,
        locationId: fromLocationId,
        delta: -amount,
        type: "transfer_out",
        referenceType: "transfer",
        referenceId: toLocationId,
        notes,
        performedBy: req.user?.id,
      });
      const into = await applyStockDelta(tx, {
        itemId: req.params.id,
        locationId: toLocationId,
        delta: amount,
        type: "transfer_in",
        referenceType: "transfer",
        referenceId: fromLocationId,
        notes,
        performedBy: req.user?.id,
      });
      return { from: out.stock, to: into.stock };
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    if (err.status)
      return res
        .status(err.status)
        .json({ success: false, error: err.message });
    console.error("inventory.transfer error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const getTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const { skip, take } = paginate(page, limit);
    const where = { inventoryItemId: req.params.id };

    const [transactions, total] = await Promise.all([
      prisma.inventoryTransaction.findMany({
        where,
        skip,
        take,
        orderBy: { transactionDate: "desc" },
        include: {
          stockLocation: { select: { id: true, name: true, code: true } },
        },
      }),
      prisma.inventoryTransaction.count({ where }),
    ]);

    return res.json({
      success: true,
      ...paginatedResponse(transactions, total, page, limit),
    });
  } catch (err) {
    console.error("inventory.getTransactions error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ─── Job parts consumption ───────────────────────────────────────────────────────

/**
 * Issue a part from a stock location (usually the tech's truck) onto a job.
 * Body: { jobId, inventoryItemId, stockLocationId, quantity, notes? }
 * Returns the movement plus a suggested sell price from the linked pricebook
 * item (falling back to the item's average cost).
 */
const issueToJob = async (req, res) => {
  try {
    const { jobId, inventoryItemId, stockLocationId, quantity, notes } =
      req.body;
    const amount = Number(quantity);
    if (!jobId || !inventoryItemId || !stockLocationId)
      return res.status(400).json({
        success: false,
        error: "jobId, inventoryItemId and stockLocationId are required",
      });
    if (!(amount > 0))
      return res
        .status(400)
        .json({ success: false, error: "quantity must be greater than 0" });

    const [job, item] = await Promise.all([
      prisma.job.findUnique({
        where: { id: jobId },
        select: { id: true, jobNumber: true },
      }),
      prisma.inventoryItem.findUnique({
        where: { id: inventoryItemId },
        include: { pricebookItem: { select: { unitPrice: true } } },
      }),
    ]);
    if (!job)
      return res.status(404).json({ success: false, error: "Job not found" });
    if (!item)
      return res.status(404).json({ success: false, error: "Item not found" });

    const { transaction } = await prisma.$transaction((tx) =>
      applyStockDelta(tx, {
        itemId: inventoryItemId,
        locationId: stockLocationId,
        delta: -amount,
        type: "issue",
        unitCost: Number(item.unitCost),
        referenceType: "job",
        referenceId: job.id,
        referenceNumber: job.jobNumber,
        jobId: job.id,
        notes,
        performedBy: req.user?.id,
      }),
    );

    const suggestedPrice = item.pricebookItem
      ? Number(item.pricebookItem.unitPrice)
      : Number(item.unitCost);

    return res.status(201).json({
      success: true,
      data: { transaction, suggestedPrice },
    });
  } catch (err) {
    if (err.status)
      return res
        .status(err.status)
        .json({ success: false, error: err.message });
    console.error("inventory.issueToJob error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

/**
 * Parts consumed on a job: non-reversed "issue" movements linked to it, with a
 * suggested sell price per line (pricebook price, falling back to avg cost).
 */
const getJobParts = async (req, res) => {
  try {
    const transactions = await prisma.inventoryTransaction.findMany({
      where: {
        jobId: req.params.jobId,
        type: "issue",
        isReversed: false,
      },
      orderBy: { transactionDate: "desc" },
      include: {
        inventoryItem: {
          select: {
            id: true,
            sku: true,
            name: true,
            unit: true,
            unitCost: true,
            pricebookItem: { select: { unitPrice: true, name: true } },
          },
        },
        stockLocation: { select: { id: true, name: true, code: true } },
      },
    });

    const canSeeCostValue = await canSeeCost(req);
    const parts = transactions.map((t) => {
      const quantityUsed = Math.abs(Number(t.quantity));
      const unitPrice = t.inventoryItem.pricebookItem
        ? Number(t.inventoryItem.pricebookItem.unitPrice)
        : Number(t.inventoryItem.unitCost);
      return {
        transactionId: t.id,
        inventoryItemId: t.inventoryItemId,
        sku: t.inventoryItem.sku,
        name: t.inventoryItem.name,
        unit: t.inventoryItem.unit,
        stockLocation: t.stockLocation,
        quantityUsed,
        // Wholesale cost is only meaningful to someone who manages inventory --
        // anyone who can merely view a job (including a technician) otherwise
        // sees the suggested sale price/total, never the margin.
        ...(canSeeCostValue && {
          unitCost: Number(t.unitCost ?? t.inventoryItem.unitCost),
        }),
        unitPrice,
        total: Math.round(quantityUsed * unitPrice * 100) / 100,
        transactionDate: t.transactionDate,
        notes: t.notes,
      };
    });

    return res.json({ success: true, data: parts });
  } catch (err) {
    console.error("inventory.getJobParts error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

/**
 * Reverse a stock movement (append-only correction): posts the opposite
 * movement at the same location and links the pair. Used to undo a mistaken
 * issue/adjustment without editing history.
 */
const reverseTransaction = async (req, res) => {
  try {
    // Techs hold the narrower inventory.issueToJob permission, not the full
    // inventory.manage -- they may only undo a part they personally issued to
    // one of their own jobs (mirroring the "Add part" action), never an
    // arbitrary adjustment, transfer, or PO receipt elsewhere in the system.
    const granted = await permissionsService.getForRole(req.user.role);
    const hasFullManage = granted.includes("inventory.manage");

    if (!hasFullManage) {
      const check = await prisma.inventoryTransaction.findUnique({
        where: { id: req.params.id },
      });
      if (!check) {
        return res
          .status(404)
          .json({ success: false, error: "Transaction not found" });
      }
      if (check.type !== "issue" || !check.jobId) {
        return res.status(403).json({
          success: false,
          error: "You can only reverse a part you issued to a job.",
        });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const original = await tx.inventoryTransaction.findUnique({
        where: { id: req.params.id },
      });
      if (!original) {
        const e = new Error("Transaction not found");
        e.status = 404;
        throw e;
      }
      if (original.isReversed) {
        const e = new Error("Transaction is already reversed");
        e.status = 400;
        throw e;
      }
      if (original.type === "reversal" || original.reversalOfId) {
        const e = new Error("A reversal cannot be reversed");
        e.status = 400;
        throw e;
      }

      const { transaction: reversal } = await applyStockDelta(tx, {
        itemId: original.inventoryItemId,
        locationId: original.stockLocationId,
        delta: -Number(original.quantity),
        type: "reversal",
        unitCost: original.unitCost === null ? null : Number(original.unitCost),
        referenceType: "transaction_reversal",
        referenceId: original.id,
        jobId: original.jobId,
        notes: req.body.reason || null,
        performedBy: req.user?.id,
      });

      await tx.inventoryTransaction.update({
        where: { id: reversal.id },
        data: { reversalOfId: original.id },
      });
      return tx.inventoryTransaction.update({
        where: { id: original.id },
        data: {
          isReversed: true,
          reversedAt: new Date(),
          reversalReason: req.body.reason || null,
        },
      });
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    if (err.status)
      return res
        .status(err.status)
        .json({ success: false, error: err.message });
    console.error("inventory.reverseTransaction error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ─── Cycle count ───────────────────────────────────────────────────────────────────

/**
 * Apply a physical count at one location.
 * Body: { stockLocationId, counts: [{ inventoryItemId, countedQuantity }], notes? }
 * Posts a "count" movement for every variance, stamps lastCountDate on every
 * counted row, and returns a variance summary.
 */
const cycleCount = async (req, res) => {
  try {
    const { stockLocationId, counts, notes } = req.body;
    if (!stockLocationId || !Array.isArray(counts) || counts.length === 0)
      return res.status(400).json({
        success: false,
        error: "stockLocationId and a non-empty counts array are required",
      });

    const results = await prisma.$transaction(async (tx) => {
      const summary = [];
      for (const c of counts) {
        const counted = Number(c.countedQuantity);
        if (!c.inventoryItemId || Number.isNaN(counted) || counted < 0) {
          const e = new Error(
            "Each count needs inventoryItemId and a countedQuantity >= 0",
          );
          e.status = 400;
          throw e;
        }
        const stockRow = await tx.inventoryStock.findUnique({
          where: {
            inventoryItemId_stockLocationId: {
              inventoryItemId: c.inventoryItemId,
              stockLocationId,
            },
          },
        });
        const expected = Number(stockRow?.quantityOnHand ?? 0);
        const variance = qty(counted - expected);

        if (variance !== 0) {
          await applyStockDelta(tx, {
            itemId: c.inventoryItemId,
            locationId: stockLocationId,
            delta: variance,
            type: "count",
            referenceType: "cycle_count",
            notes: notes || "Cycle count variance",
            performedBy: req.user?.id,
          });
        }
        // Stamp the count date even when the count matched.
        await tx.inventoryStock.upsert({
          where: {
            inventoryItemId_stockLocationId: {
              inventoryItemId: c.inventoryItemId,
              stockLocationId,
            },
          },
          update: { lastCountDate: new Date() },
          create: {
            inventoryItemId: c.inventoryItemId,
            stockLocationId,
            quantityOnHand: 0,
            lastCountDate: new Date(),
          },
        });

        summary.push({
          inventoryItemId: c.inventoryItemId,
          expected,
          counted,
          variance,
        });
      }
      return summary;
    });

    const varianceCount = results.filter((r) => r.variance !== 0).length;
    return res.json({
      success: true,
      data: { counted: results.length, variances: varianceCount, results },
    });
  } catch (err) {
    if (err.status)
      return res
        .status(err.status)
        .json({ success: false, error: err.message });
    console.error("inventory.cycleCount error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ─── CSV import ────────────────────────────────────────────────────────────────────

/**
 * Bulk-create inventory items from parsed CSV rows. Columns:
 *   sku, name, unit, quantity, unitCost, reorderPoint, reorderQuantity,
 *   vendorName, locationCode, serialized
 * Opening stock goes to `locationCode` (or the default warehouse). Unknown
 * vendors are created on the fly. Returns per-row results.
 */
const importItems = async (req, res) => {
  try {
    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    if (rows.length === 0)
      return res
        .status(400)
        .json({ success: false, error: "No rows to import" });
    if (rows.length > 1000)
      return res
        .status(400)
        .json({ success: false, error: "Import is limited to 1000 rows" });

    const toNum = (v) => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    const truthy = (v) =>
      ["true", "yes", "y", "1"].includes(
        String(v ?? "")
          .trim()
          .toLowerCase(),
      );

    const defaultLocation = await prisma.stockLocation.findFirst({
      where: { isDefault: true },
    });
    const locationsByCode = new Map(
      (await prisma.stockLocation.findMany()).map((l) => [
        l.code.toLowerCase(),
        l,
      ]),
    );
    const vendorsByName = new Map(
      (await prisma.vendor.findMany()).map((v) => [v.name.toLowerCase(), v]),
    );

    let created = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const sku = (r.sku || "").trim();
      const name = (r.name || "").trim();
      if (!sku || !name) {
        errors.push({ row: i + 1, error: "Missing sku or name" });
        continue;
      }

      try {
        // Resolve / create the vendor outside the row transaction.
        let vendor = null;
        const vendorName = (r.vendorName || "").trim();
        if (vendorName) {
          vendor = vendorsByName.get(vendorName.toLowerCase()) ?? null;
          if (!vendor) {
            const settings = await prisma.companySettings.findFirst();
            vendor = await prisma.vendor.create({
              data: {
                vendorNumber: generateNumber(
                  settings.vendorPrefix,
                  settings.nextVendorNumber,
                ),
                name: vendorName,
              },
            });
            await prisma.companySettings.update({
              where: { id: settings.id },
              data: { nextVendorNumber: { increment: 1 } },
            });
            vendorsByName.set(vendorName.toLowerCase(), vendor);
          }
        }

        const locationCode = (r.locationCode || "").trim().toLowerCase();
        const location = locationCode
          ? locationsByCode.get(locationCode)
          : defaultLocation;
        const openingQty = toNum(r.quantity);
        if (openingQty > 0 && !location) {
          errors.push({
            row: i + 1,
            error: `Unknown locationCode "${r.locationCode}" and no default warehouse`,
          });
          continue;
        }

        await prisma.$transaction(async (tx) => {
          const item = await tx.inventoryItem.create({
            data: {
              sku,
              name,
              unit: (r.unit || "each").trim(),
              unitCost: money(toNum(r.unitCost)),
              reorderPoint: qty(toNum(r.reorderPoint)),
              reorderQuantity: qty(toNum(r.reorderQuantity)),
              isSerialized: truthy(r.serialized),
              defaultVendorId: vendor?.id ?? null,
              ...(vendor
                ? {
                    vendors: {
                      create: {
                        vendorId: vendor.id,
                        unitCost: money(toNum(r.unitCost)),
                        isPrimary: true,
                      },
                    },
                  }
                : {}),
            },
          });
          if (openingQty > 0 && location) {
            await applyStockDelta(tx, {
              itemId: item.id,
              locationId: location.id,
              delta: qty(openingQty),
              type: "adjustment",
              unitCost: money(toNum(r.unitCost)),
              referenceType: "import",
              notes: "CSV import opening balance",
              performedBy: req.user?.id,
            });
          }
        });
        created += 1;
      } catch (e) {
        errors.push({
          row: i + 1,
          error: e.code === "P2002" ? "Duplicate SKU" : e.message || "Failed",
        });
      }
    }

    return res.json({
      success: true,
      data: { created, failed: errors.length, errors },
    });
  } catch (err) {
    console.error("inventory.importItems error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

// ─── Per-vendor catalog pricing ────────────────────────────────

const addVendor = async (req, res) => {
  try {
    const {
      vendorId,
      unitCost,
      vendorSku,
      leadTimeDays,
      minimumOrderQty,
      isPrimary,
    } = req.body;
    if (!vendorId || unitCost === undefined)
      return res.status(400).json({
        success: false,
        error: "vendorId and unitCost are required",
      });

    const link = await prisma.inventoryItemVendor.create({
      data: {
        inventoryItemId: req.params.id,
        vendorId,
        unitCost: money(unitCost),
        vendorSku: vendorSku || null,
        leadTimeDays: leadTimeDays ?? null,
        minimumOrderQty: minimumOrderQty ?? null,
        isPrimary: !!isPrimary,
      },
      include: { vendor: { select: { id: true, name: true } } },
    });
    return res.status(201).json({ success: true, data: link });
  } catch (err) {
    if (err.code === "P2002")
      return res.status(409).json({
        success: false,
        error: "That vendor is already linked to this item",
      });
    console.error("inventory.addVendor error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

const removeVendor = async (req, res) => {
  try {
    await prisma.inventoryItemVendor.delete({
      where: { id: req.params.linkId },
    });
    return res.json({ success: true, message: "Vendor link removed" });
  } catch (err) {
    if (err.code === "P2025")
      return res
        .status(404)
        .json({ success: false, error: "Vendor link not found" });
    console.error("inventory.removeVendor error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = {
  list,
  get,
  create,
  update,
  remove,
  adjust,
  transfer,
  getTransactions,
  addVendor,
  removeVendor,
  issueToJob,
  getJobParts,
  reverseTransaction,
  cycleCount,
  importItems,
};
