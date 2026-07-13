/**
 * Quote (Estimate) importer for a QuickBooks/FieldEdge-style export.
 *
 * CSV columns: Customer, Address, Quote #, Quote Date, Status,
 *              Expiration Date, Amount, Multi-Option, Printed, Emailed
 *
 * For each row we find-or-create the Customer (reusing ones already imported
 * from agreements; new ones get the Address as a primary Location), then create
 * an Estimate (+ a single summary line item so totals and the line table are
 * consistent). Existing estimates are cleared first (invoice.estimateId refs
 * are detached; EstimateLineItems cascade).
 *
 * Status mapping: Scheduled/Accepted -> approved, Pending -> sent,
 *                 Rejected -> rejected, anything else -> draft.
 *
 * Derived: title <- Address; total/subtotal <- Amount; validUntil <- Expiration
 * Date; createdAt <- Quote Date; sentAt/approvedAt/rejectedAt set from status
 * and the Emailed flag.
 *
 * Usage (DATABASE_URL set):
 *   node scripts/import-quotes.js "<csvPath>" [--dry-run] [--no-clear]
 */
const fs = require("fs");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noClear = args.includes("--no-clear");
const csvPath = args.find((a) => !a.startsWith("--"));

if (!csvPath) {
  console.error('Usage: node scripts/import-quotes.js "<csvPath>" [--dry-run] [--no-clear]');
  process.exit(1);
}

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
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      // ignore
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const stripQuotes = (s) => (s || "").replace(/^["\s]+|["\s]+$/g, "");
const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "\u2026" : s);

function parseDate(s) {
  const t = (s || "").trim().slice(0, 10); // "2025-08-21 12:00 AM" -> "2025-08-21"
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

const COMMERCIAL =
  /\b(LLC|L\.L\.C|Inc|Incorporated|Corp|Company|Trust|Club|CC|Dentistry|Dental|Confections|Salon|Hair|Reserve|Sailfish|Golf|Storage|Residence)\b/i;

function parseName(raw) {
  const name = raw.trim();
  if (COMMERCIAL.test(name)) return { type: "commercial", firstName: "", lastName: name, companyName: name };
  if (name.includes(",")) {
    const idx = name.indexOf(",");
    return { type: "residential", lastName: name.slice(0, idx).trim(), firstName: name.slice(idx + 1).trim(), companyName: null };
  }
  if (/^\d/.test(name) || name.includes("/")) return { type: "commercial", firstName: "", lastName: name, companyName: name };
  const words = name.split(/\s+/);
  if (words.length >= 2) return { type: "residential", lastName: words[0], firstName: words.slice(1).join(" "), companyName: null };
  return { type: "residential", firstName: "", lastName: name, companyName: null };
}

// Handles both "street - City STATE zip" and "street City STATE zip" (no dash).
function parseAddress(raw) {
  const s = (raw || "").trim();
  if (!s) return { address: "", city: "", state: "", zip: "" };
  const dash = s.lastIndexOf(" - ");
  if (dash >= 0) {
    const address = s.slice(0, dash).trim();
    const tokens = s.slice(dash + 3).trim().split(/\s+/);
    return {
      address,
      zip: (tokens[tokens.length - 1] || "").replace(/[^0-9]/g, ""),
      state: (tokens[tokens.length - 2] || "").replace(/[^A-Za-z]/g, "").toUpperCase(),
      city: tokens.slice(0, Math.max(0, tokens.length - 2)).join(" "),
    };
  }
  // No delimiter: reliably peel zip + state off the end, keep the rest as address.
  const tokens = s.split(/\s+/);
  const zip = (tokens[tokens.length - 1] || "").replace(/[^0-9]/g, "");
  const state = (tokens[tokens.length - 2] || "").replace(/[^A-Za-z]/g, "").toUpperCase();
  const address = tokens.slice(0, Math.max(0, tokens.length - 2)).join(" ");
  return { address, city: "", state, zip };
}

function mapStatus(s) {
  const t = (s || "").trim().toLowerCase();
  if (t === "scheduled" || t === "accepted") return "approved";
  if (t === "pending") return "sent";
  if (t === "rejected") return "rejected";
  return "draft";
}

async function main() {
  const raw = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(raw).filter((r) => r.some((c) => c && c.trim() !== ""));
  const header = rows.shift().map((h) => h.trim());
  const idx = (n) => header.indexOf(n);
  const iCust = idx("Customer");
  const iAddr = idx("Address");
  const iNum = idx("Quote #");
  const iDate = idx("Quote Date");
  const iStatus = idx("Status");
  const iExp = idx("Expiration Date");
  const iAmt = idx("Amount");
  const iEmail = idx("Emailed");
  const iMulti = idx("Multi-Option");
  const iPrint = idx("Printed");

  const records = [];
  const seen = new Set();
  const dupes = [];
  const statusCount = {};

  for (const r of rows) {
    const quoteNumber = (r[iNum] || "").trim();
    if (!quoteNumber) continue;
    if (seen.has(quoteNumber)) {
      dupes.push(quoteNumber);
      continue;
    }
    seen.add(quoteNumber);

    const customerName = stripQuotes(r[iCust]);
    const addressRaw = stripQuotes(r[iAddr]);
    const status = mapStatus(r[iStatus]);
    const quoteDate = parseDate(r[iDate]);
    const validUntil = parseDate(r[iExp]);
    const amount = parseFloat((r[iAmt] || "0").replace(/[^0-9.\-]/g, "")) || 0;
    const emailed = /true/i.test(r[iEmail] || "");
    const multi = /true/i.test(r[iMulti] || "");
    const printed = /true/i.test(r[iPrint] || "");

    statusCount[status] = (statusCount[status] || 0) + 1;

    records.push({
      quoteNumber,
      customerName,
      person: parseName(customerName),
      addr: parseAddress(addressRaw),
      title: truncate(addressRaw || "Service Quote", 120),
      status,
      quoteDate,
      validUntil,
      amount,
      emailed,
      summary: `Imported quote \u2014 Multi-Option: ${multi ? "Yes" : "No"}, Printed: ${printed ? "Yes" : "No"}, Emailed: ${emailed ? "Yes" : "No"}`,
    });
  }

  console.log("── Parse report ─────────────────────────────────────────────");
  console.log(`CSV rows (excl. header):  ${rows.length}`);
  console.log(`Importable quotes:        ${records.length}`);
  console.log(`Duplicate quote #s:       ${dupes.length}${dupes.length ? " (" + dupes.join(", ") + ")" : ""}`);
  console.log(`Distinct customers:       ${new Set(records.map((r) => r.customerName)).size}`);
  console.log(`Mapped status counts:     ${JSON.stringify(statusCount)}`);
  console.log("Samples (first 4):");
  for (const x of records.slice(0, 4)) {
    const disp = x.person.companyName || `${x.person.firstName} ${x.person.lastName}`.trim();
    console.log(`  ${x.quoteNumber} | ${disp} | $${x.amount} | ${x.status} | ${x.quoteDate ? x.quoteDate.toISOString().slice(0, 10) : "-"} | ${x.addr.state} ${x.addr.zip}`);
  }
  console.log("─────────────────────────────────────────────────────────────");

  if (dryRun) {
    console.log("DRY RUN — no database changes made.");
    return;
  }

  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const admin = await prisma.user.findFirst({ where: { role: "admin" }, select: { id: true } });
    if (!admin) throw new Error("No admin user found to own the estimates.");

    if (!noClear) {
      await prisma.invoice.updateMany({ where: { estimateId: { not: null } }, data: { estimateId: null } });
      const del = await prisma.estimate.deleteMany({}); // line items cascade
      console.log(`Cleared ${del.count} existing estimates (line items cascaded, invoice refs detached).`);
    }

    const existingNumbers = new Set(
      (await prisma.customer.findMany({ select: { customerNumber: true } })).map((c) => c.customerNumber),
    );
    let seq = 3001;
    const nextCustomerNumber = () => {
      let n;
      do {
        n = `CUST-${seq++}`;
      } while (existingNumbers.has(n));
      existingNumbers.add(n);
      return n;
    };

    const custCache = new Map();
    async function findOrCreateCustomer(name, person, addr) {
      if (custCache.has(name)) return custCache.get(name);
      const where = person.type === "commercial" ? { companyName: name } : { firstName: person.firstName, lastName: person.lastName };
      let cust = await prisma.customer.findFirst({ where });
      if (!cust) {
        cust = await prisma.customer.create({
          data: {
            customerNumber: nextCustomerNumber(),
            firstName: person.firstName || "",
            lastName: person.lastName || name,
            phone: "",
            type: person.type,
            companyName: person.companyName,
            source: "import",
            locations: addr.address
              ? { create: { name: "Service Address", address: addr.address, city: addr.city, state: addr.state, zip: addr.zip, type: "service", isPrimary: true } }
              : undefined,
          },
        });
      }
      custCache.set(name, cust);
      return cust;
    }

    let created = 0;
    let reused = 0;
    for (const x of records) {
      const before = custCache.size;
      const cust = await findOrCreateCustomer(x.customerName, x.person, x.addr);
      if (custCache.size === before) reused++;
      await prisma.estimate.create({
        data: {
          estimateNumber: x.quoteNumber,
          customerId: cust.id,
          createdById: admin.id,
          title: x.title,
          summary: x.summary,
          status: x.status,
          subtotal: x.amount,
          total: x.amount,
          validUntil: x.validUntil,
          createdAt: x.quoteDate || undefined,
          sentAt: x.emailed || x.status !== "draft" ? x.quoteDate : null,
          approvedAt: x.status === "approved" ? x.quoteDate : null,
          rejectedAt: x.status === "rejected" ? x.quoteDate : null,
          lineItems: {
            create: {
              type: "service",
              name: x.title || "Quoted work",
              quantity: 1,
              unitPrice: x.amount,
              total: x.amount,
              sortOrder: 0,
            },
          },
        },
      });
      created++;
    }

    const total = await prisma.estimate.count();
    console.log(`Imported ${created} estimates. Estimate table now holds ${total} rows.`);
    console.log(`Customers created this run: ${custCache.size} | quotes reusing an existing customer: ${reused}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
