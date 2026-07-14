/**
 * Bulk item importer for a QuickBooks/FieldEdge-style items export.
 *
 * CSV columns expected: Item Name, Description, Mfg Part #, Category, Rate, Item Type
 *
 * Mapping into InventoryItem:
 *   sku         <- Item Name (must be non-empty & unique; later dupes skipped)
 *   name        <- Description (fallback: Item Name), trimmed to 150 chars
 *   description <- Description (full)
 *   unitCost    <- Rate (weighted-average cost seed; InventoryItem has no sale price)
 *   categoryId  <- Category, resolved to a PricebookCategory (":" makes a child)
 *   notes       <- "Mfg Part #: <x>" when present
 *   isStockItem <- true only when Item Type == "Inventory"
 *   unit        <- "each"
 *   isActive=true, isArchived=false
 *
 * Usage (from the backend/ working dir, DATABASE_URL set):
 *   node scripts/import-items.js "<csvPath>" [--dry-run] [--no-clear]
 *
 * --dry-run : parse + report only, no DB writes.
 * --no-clear: import without first clearing existing inventory.
 *
 * When clearing, dependent rows that would otherwise block the delete are
 * removed/detached first: InventoryTransaction, InventoryItemCostHistory,
 * SerializedUnit are deleted; POLine.inventoryItemId is nulled. InventoryStock
 * and InventoryItemSupplier cascade automatically.
 */
const fs = require("fs");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noClear = args.includes("--no-clear");
const csvPath = args.find((a) => !a.startsWith("--"));

if (!csvPath) {
  console.error('Usage: node scripts/import-items.js "<csvPath>" [--dry-run] [--no-clear]');
  process.exit(1);
}

// ── Minimal RFC-4180 CSV parser (handles quoted fields, embedded commas,
//    escaped "" quotes, and CRLF/LF newlines). ──────────────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      // ignore; handled with \n
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "\u2026" : s;
}

async function main() {
  const raw = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(raw).filter((r) => r.some((c) => c && c.trim() !== ""));
  const header = rows.shift().map((h) => h.trim());

  const col = (name) => header.indexOf(name);
  const iName = col("Item Name");
  const iDesc = col("Description");
  const iMfg = col("Mfg Part #");
  const iCat = col("Category");
  const iRate = col("Rate");
  const iType = col("Item Type");
  if (iName < 0 || iRate < 0) {
    throw new Error(
      `CSV header missing expected columns. Found: ${header.join(", ")}`,
    );
  }

  const items = [];
  const seenSku = new Set();
  const dupes = [];
  const blanks = [];
  const categorySet = new Set();
  const byType = {};

  for (const r of rows) {
    const sku = (r[iName] || "").trim();
    if (!sku) {
      blanks.push(r);
      continue;
    }
    if (seenSku.has(sku)) {
      dupes.push(sku);
      continue;
    }
    seenSku.add(sku);

    const desc = (r[iDesc] || "").trim();
    const mfg = iMfg >= 0 ? (r[iMfg] || "").trim() : "";
    const category = iCat >= 0 ? (r[iCat] || "").trim() : "";
    const type = iType >= 0 ? (r[iType] || "").trim() : "";
    const rate = parseFloat((r[iRate] || "0").replace(/[^0-9.-]/g, "")) || 0;

    if (category) categorySet.add(category);
    byType[type || "(blank)"] = (byType[type || "(blank)"] || 0) + 1;

    items.push({
      sku,
      name: truncate(desc || sku, 150),
      description: desc || null,
      unitCost: rate,
      categoryRaw: category,
      notes: mfg ? `Mfg Part #: ${mfg}` : null,
      isStockItem: type.toLowerCase() === "inventory",
      unit: "each",
      isActive: true,
      isArchived: false,
    });
  }

  console.log("── Parse report ─────────────────────────────────────────────");
  console.log(`CSV rows (excl. header):   ${rows.length}`);
  console.log(`Importable items:          ${items.length}`);
  console.log(`Skipped (blank Item Name): ${blanks.length}`);
  console.log(`Skipped (duplicate SKU):   ${dupes.length}`);
  console.log(`Distinct categories:       ${categorySet.size}`);
  console.log(`By Item Type:              ${JSON.stringify(byType)}`);
  if (dupes.length) console.log(`Duplicate SKUs: ${[...new Set(dupes)].slice(0, 20).join(", ")}${dupes.length > 20 ? " …" : ""}`);
  console.log("Sample (first 3):");
  for (const it of items.slice(0, 3)) {
    console.log(`  ${it.sku} | ${it.name} | $${it.unitCost} | ${it.categoryRaw || "(none)"} | stock=${it.isStockItem}`);
  }
  console.log("─────────────────────────────────────────────────────────────");

  if (dryRun) {
    console.log("DRY RUN — no database changes made.");
    return;
  }

  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();

  try {
    if (!noClear) {
      console.log("Clearing existing inventory …");
      await prisma.$transaction([
        prisma.inventoryTransaction.deleteMany({}),
        prisma.inventoryItemCostHistory.deleteMany({}),
        prisma.serializedUnit.deleteMany({}),
        prisma.pOLine.updateMany({
          where: { inventoryItemId: { not: null } },
          data: { inventoryItemId: null },
        }),
        // InventoryStock + InventoryItemSupplier cascade on item delete.
        prisma.inventoryItem.deleteMany({}),
      ]);
      console.log("Existing inventory cleared.");
    }

    // Resolve categories to PricebookCategory ids (find-or-create, ":" => child).
    const catCache = new Map();
    async function resolveCategory(raw) {
      if (!raw) return null;
      if (catCache.has(raw)) return catCache.get(raw);
      const [topName, childName] = raw.split(":").map((s) => s.trim());
      let top = await prisma.pricebookCategory.findFirst({
        where: { name: topName, parentId: null },
      });
      top ||= await prisma.pricebookCategory.create({ data: { name: topName } });
      let leafId = top.id;
      if (childName) {
        let child = await prisma.pricebookCategory.findFirst({
          where: { name: childName, parentId: top.id },
        });
        child ||= await prisma.pricebookCategory.create({
          data: { name: childName, parentId: top.id },
        });
        leafId = child.id;
      }
      catCache.set(raw, leafId);
      return leafId;
    }

    for (const it of items) {
      it.categoryId = await resolveCategory(it.categoryRaw);
    }
    console.log(`Resolved ${catCache.size} categories.`);

    const data = items.map((it) => ({
      sku: it.sku,
      name: it.name,
      description: it.description,
      unitCost: it.unitCost,
      categoryId: it.categoryId,
      notes: it.notes,
      isStockItem: it.isStockItem,
      unit: it.unit,
      isActive: it.isActive,
      isArchived: it.isArchived,
    }));

    const result = await prisma.inventoryItem.createMany({ data });
    console.log(`Imported ${result.count} inventory items.`);

    const total = await prisma.inventoryItem.count();
    console.log(`InventoryItem table now holds ${total} rows.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
