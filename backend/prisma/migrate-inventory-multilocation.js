/**
 * Data migration: single-location inventory  ->  multi-location inventory.
 *
 * The inventory subsystem moved from a flat model (quantity stored directly on
 * InventoryItem, one required Warehouse per item) to a multi-location model
 * (StockLocation = warehouse | truck, quantities in InventoryStock, perpetual
 * weighted-average costing, purchase orders, receiving, serialized units).
 *
 * Because the project applies its schema with `prisma db push` (no migration
 * files) and the change is destructive, this runs in two phases around the push:
 *
 *   1) node prisma/migrate-inventory-multilocation.js export --drop
 *        Dumps legacy Warehouse / InventoryItem / InventoryTransaction rows to
 *        prisma/inventory-legacy-backup.json. With --drop it then drops those
 *        legacy tables so the following push can recreate them cleanly (avoids
 *        alter-in-place constraint conflicts, e.g. the new required unique sku).
 *
 *   2) npx prisma db push            # builds the new tables
 *      npm run db:seed               # seeds the new metadata / lookups
 *
 *   3) node prisma/migrate-inventory-multilocation.js import
 *        Recreates StockLocations, InventoryItems, InventoryStock and
 *        InventoryTransactions from the backup JSON.
 *
 * For a throwaway dev/demo database you can skip all of this and simply run
 * `docker compose down -v` (or drop the DB) then `db push` + `db:seed` to start
 * fresh — the current inventory rows are seeded demo data. This script exists to
 * preserve inventory data on databases that must not be wiped.
 *
 * The script is safe to re-run: import upserts by id.
 */

const path = require("path");
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const BACKUP_FILE = path.join(__dirname, "inventory-legacy-backup.json");

// Legacy InventoryTransaction.type  ->  new inventoryTransactionType lookup value
const TXN_TYPE_MAP = {
  purchase: "receipt",
  usage: "issue",
  adjustment: "adjustment",
  transfer: "transfer_out",
  return: "receipt",
};

// ─── EXPORT ──────────────────────────────────────────────────────────────────

async function readLegacyTable(table) {
  try {
    return await prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`);
  } catch (err) {
    // 42P01 = undefined_table: legacy table already gone; treat as empty.
    if (err.code === "P2010" || /does not exist/i.test(err.message)) {
      console.warn(`  (table "${table}" not found — skipping)`);
      return [];
    }
    throw err;
  }
}

async function runExport(drop) {
  console.log("Exporting legacy inventory data...");

  const warehouses = await readLegacyTable("Warehouse");
  const items = await readLegacyTable("InventoryItem");
  const transactions = await readLegacyTable("InventoryTransaction");

  const payload = { exportedAt: new Date().toISOString(), warehouses, items, transactions };
  fs.writeFileSync(BACKUP_FILE, JSON.stringify(payload, bigintReplacer, 2));

  console.log(
    `  Saved ${warehouses.length} warehouse(s), ${items.length} item(s), ` +
      `${transactions.length} transaction(s) -> ${path.basename(BACKUP_FILE)}`,
  );

  if (drop) {
    console.log("Dropping legacy tables (order respects FKs)...");
    // Order matters: InventoryTransaction references InventoryItem, which
    // references Warehouse.
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "InventoryTransaction" CASCADE`);
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "InventoryItem" CASCADE`);
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "Warehouse" CASCADE`);
    console.log("  Legacy tables dropped. Now run: npx prisma db push && npm run db:seed");
  } else {
    console.log("  (pass --drop to also remove legacy tables before `prisma db push`)");
  }
}

// Decimal/JSON helper: BigInt is not serializable by default.
function bigintReplacer(_key, value) {
  return typeof value === "bigint" ? Number(value) : value;
}

// ─── IMPORT ──────────────────────────────────────────────────────────────────

function slugCode(name, fallback) {
  const base = String(name || fallback || "LOC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
  return base || fallback;
}

function num(value, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function runImport() {
  if (!fs.existsSync(BACKUP_FILE)) {
    throw new Error(
      `Backup file not found: ${BACKUP_FILE}. Run the "export" phase first.`,
    );
  }
  const { warehouses, items, transactions } = JSON.parse(
    fs.readFileSync(BACKUP_FILE, "utf8"),
  );

  console.log("Importing into multi-location inventory model...");

  // 1) Warehouses -> StockLocations (reuse ids so item/txn references stay valid)
  const usedCodes = new Set();
  const locationIdByWarehouse = new Map();

  const sourceWarehouses =
    warehouses.length > 0
      ? warehouses
      : [{ id: null, name: "Main Warehouse", address: null, isActive: true }];

  let defaultLocationId = null;

  for (let i = 0; i < sourceWarehouses.length; i++) {
    const wh = sourceWarehouses[i];
    let code = slugCode(wh.name, `WH${i + 1}`);
    let suffix = 1;
    while (usedCodes.has(code)) code = `${slugCode(wh.name, "WH")}${suffix++}`;
    usedCodes.add(code);

    const isDefault = i === 0;
    const data = {
      name: wh.name || `Warehouse ${i + 1}`,
      code,
      type: "warehouse",
      address: wh.address ?? null,
      isDefault,
      isActive: wh.isActive ?? true,
    };

    const location = wh.id
      ? await prisma.stockLocation.upsert({
          where: { id: wh.id },
          update: data,
          create: { id: wh.id, ...data },
        })
      : await prisma.stockLocation.create({ data });

    if (wh.id) locationIdByWarehouse.set(wh.id, location.id);
    if (isDefault) defaultLocationId = location.id;
  }

  console.log(`  StockLocations: ${sourceWarehouses.length}`);

  const resolveLocation = (warehouseId) =>
    locationIdByWarehouse.get(warehouseId) || defaultLocationId;

  // 2) InventoryItems (generate a sku when missing/duplicate; move quantity out)
  const usedSkus = new Set();
  let itemCount = 0;
  let stockCount = 0;

  for (const it of items) {
    let sku = (it.sku || "").trim();
    if (!sku) sku = `LEGACY-${it.id.slice(0, 8)}`;
    let candidate = sku;
    let suffix = 1;
    while (usedSkus.has(candidate)) candidate = `${sku}-${suffix++}`;
    sku = candidate;
    usedSkus.add(sku);

    const itemData = {
      sku,
      name: it.name,
      pricebookItemId: it.pricebookItemId ?? null,
      unit: "each",
      unitCost: num(it.unitCost),
      reorderPoint: num(it.reorderPoint),
      reorderQuantity: num(it.reorderQuantity),
      isActive: true,
      notes: it.location ? `Legacy location: ${it.location}` : null,
    };

    await prisma.inventoryItem.upsert({
      where: { id: it.id },
      update: itemData,
      create: { id: it.id, ...itemData },
    });
    itemCount++;

    // Move the flat quantity into InventoryStock at the item's warehouse.
    const locationId = resolveLocation(it.warehouseId);
    if (locationId) {
      await prisma.inventoryStock.upsert({
        where: {
          inventoryItemId_stockLocationId: {
            inventoryItemId: it.id,
            stockLocationId: locationId,
          },
        },
        update: { quantityOnHand: num(it.quantity) },
        create: {
          inventoryItemId: it.id,
          stockLocationId: locationId,
          quantityOnHand: num(it.quantity),
        },
      });
      stockCount++;
    }
  }

  console.log(`  InventoryItems: ${itemCount}   InventoryStock rows: ${stockCount}`);

  // 3) InventoryTransactions (map type + attach a location)
  const itemIds = new Set(items.map((i) => i.id));
  let txnCount = 0;
  let skipped = 0;

  for (const tx of transactions) {
    if (!itemIds.has(tx.itemId)) {
      skipped++; // orphaned transaction (item no longer present)
      continue;
    }
    const itemWarehouse = items.find((i) => i.id === tx.itemId)?.warehouseId;
    const locationId = resolveLocation(itemWarehouse);
    if (!locationId) {
      skipped++;
      continue;
    }

    const data = {
      inventoryItemId: tx.itemId,
      stockLocationId: locationId,
      type: TXN_TYPE_MAP[tx.type] || "adjustment",
      quantity: num(tx.quantity),
      unitCost: tx.unitCost === null ? null : num(tx.unitCost),
      referenceType: tx.jobId ? "job" : tx.reference ? "legacy" : null,
      referenceId: tx.jobId ?? null,
      referenceNumber: tx.reference ?? null,
      jobId: tx.jobId ?? null,
      notes: tx.notes ?? null,
      transactionDate: tx.createdAt ? new Date(tx.createdAt) : new Date(),
    };

    await prisma.inventoryTransaction.upsert({
      where: { id: tx.id },
      update: data,
      create: { id: tx.id, ...data },
    });
    txnCount++;
  }

  console.log(`  InventoryTransactions: ${txnCount} (skipped ${skipped} orphaned)`);
  console.log("Import complete.");
}

// ─── ENTRYPOINT ──────────────────────────────────────────────────────────────

async function main() {
  const [, , phase, ...flags] = process.argv;

  if (phase === "export") {
    await runExport(flags.includes("--drop"));
  } else if (phase === "import") {
    await runImport();
  } else {
    console.log(
      "Usage:\n" +
        "  node prisma/migrate-inventory-multilocation.js export [--drop]\n" +
        "  node prisma/migrate-inventory-multilocation.js import",
    );
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
