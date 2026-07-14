/**
 * Invoice importer for a QuickBooks/FieldEdge-style export.
 *
 * CSV columns: Customer, WO #, Invoice #, Date, Due Date, Total, Balance,
 *              Invoice Pay Status, WO Description, Summary
 *
 * For each row: find-or-create the Customer (reusing ones already imported),
 * then create an Invoice (+ one summary line item). Existing invoices are
 * cleared first (payments deleted, then invoices; line items cascade).
 *
 * Pay-status mapping -> invoiceStatus:
 *   NON-BILLABLE -> paid (0-dollar, settled)   OVERDUE -> overdue
 *   PAID / balance<=0 -> paid                   DUE / PENDING -> sent
 *   partial payment (0 < paid < total) -> partial
 *
 * Derived: total/balance from CSV; amountPaid = total - balance;
 * createdAt <- Date; dueDate <- Due Date; notes <- "WO #" + Summary;
 * line-item name/description <- WO Description (\CR markers -> newlines).
 *
 * Usage (DATABASE_URL set):
 *   node scripts/import-invoices.js "<csvPath>" [--dry-run] [--no-clear]
 */
const fs = require("fs");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noClear = args.includes("--no-clear");
const csvPath = args.find((a) => !a.startsWith("--"));

if (!csvPath) {
  console.error('Usage: node scripts/import-invoices.js "<csvPath>" [--dry-run] [--no-clear]');
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
// "/\CR" and "\CR" are the source's line-break markers.
const clean = (s) => (s || "").replace(/\/?\\CR/g, "\n").replace(/\n{2,}/g, "\n").trim();
const oneLine = (s) => clean(s).replace(/\s+/g, " ").trim();

function parseDate(s) {
  const t = (s || "").trim().slice(0, 10);
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

function mapStatus(raw, total, balance, amountPaid) {
  const t = (raw || "").toUpperCase();
  if (t.includes("NON-BILLABLE") || t.includes("NONBILLABLE")) return "paid";
  if (t.includes("VOID")) return "void";
  if (t.includes("OVERDUE")) return "overdue";
  if (t === "PAID" || (balance <= 0 && total > 0)) return "paid";
  if (amountPaid > 0 && balance > 0) return "partial";
  return "sent"; // DUE, PENDING, default
}

async function main() {
  const raw = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(raw).filter((r) => r.some((c) => c && c.trim() !== ""));
  const header = rows.shift().map((h) => h.trim());
  const idx = (n) => header.indexOf(n);
  const iCust = idx("Customer");
  const iWo = idx("WO #");
  const iNum = idx("Invoice #");
  const iDate = idx("Date");
  const iDue = idx("Due Date");
  const iTotal = idx("Total");
  const iBal = idx("Balance");
  const iPay = idx("Invoice Pay Status");
  const iDesc = idx("WO Description");
  const iSum = idx("Summary");

  const records = [];
  const seen = new Set();
  const dupes = [];
  const statusCount = {};

  for (const r of rows) {
    const invoiceNumber = (r[iNum] || "").trim();
    if (!invoiceNumber) continue;
    if (seen.has(invoiceNumber)) {
      dupes.push(invoiceNumber);
      continue;
    }
    seen.add(invoiceNumber);

    const customerName = stripQuotes(r[iCust]);
    const total = parseFloat((r[iTotal] || "0").replace(/[^0-9.-]/g, "")) || 0;
    const balance = parseFloat((r[iBal] || "0").replace(/[^0-9.-]/g, "")) || 0;
    const amountPaid = Math.max(0, total - balance);
    const status = mapStatus(r[iPay], total, balance, amountPaid);
    const date = parseDate(r[iDate]);
    const dueDate = parseDate(r[iDue]);
    const wo = (r[iWo] || "").trim();
    const desc = clean(r[iDesc]);
    const summary = clean(r[iSum]);

    statusCount[status] = (statusCount[status] || 0) + 1;

    records.push({
      invoiceNumber,
      customerName,
      person: parseName(customerName),
      wo,
      total,
      balance,
      amountPaid,
      status,
      date,
      dueDate,
      lineName: truncate(oneLine(r[iDesc]) || "Service", 120),
      lineDesc: desc || null,
      notes: [wo ? `WO #${wo}` : "", summary].filter(Boolean).join("\n\n") || null,
    });
  }

  console.log("── Parse report ─────────────────────────────────────────────");
  console.log(`CSV rows (excl. header):  ${rows.length}`);
  console.log(`Importable invoices:      ${records.length}`);
  console.log(`Duplicate invoice #s:     ${dupes.length}${dupes.length ? " (" + dupes.slice(0, 15).join(", ") + (dupes.length > 15 ? " …" : "") + ")" : ""}`);
  console.log(`Distinct customers:       ${new Set(records.map((r) => r.customerName)).size}`);
  console.log(`Mapped status counts:     ${JSON.stringify(statusCount)}`);
  const sum = records.reduce((a, r) => a + r.total, 0);
  const bal = records.reduce((a, r) => a + r.balance, 0);
  console.log(`Sum total / balance:      $${sum.toFixed(2)} / $${bal.toFixed(2)}`);
  console.log("Samples (first 4):");
  for (const x of records.slice(0, 4)) {
    const disp = x.person.companyName || `${x.person.firstName} ${x.person.lastName}`.trim();
    console.log(`  ${x.invoiceNumber} | ${disp} | $${x.total} (bal $${x.balance}) | ${x.status} | ${x.date ? x.date.toISOString().slice(0, 10) : "-"} | ${x.lineName.slice(0, 40)}`);
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
    if (!admin) throw new Error("No admin user found to own the invoices.");

    if (!noClear) {
      const delPay = await prisma.payment.deleteMany({});
      const del = await prisma.invoice.deleteMany({}); // line items cascade
      console.log(`Cleared ${del.count} invoices and ${delPay.count} payments (line items cascaded).`);
    }

    const existingNumbers = new Set(
      (await prisma.customer.findMany({ select: { customerNumber: true } })).map((c) => c.customerNumber),
    );
    let seq = 4001;
    const nextCustomerNumber = () => {
      let n;
      do {
        n = `CUST-${seq++}`;
      } while (existingNumbers.has(n));
      existingNumbers.add(n);
      return n;
    };

    const custCache = new Map();
    async function findOrCreateCustomer(name, person) {
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
          },
        });
      }
      custCache.set(name, cust);
      return cust;
    }

    let created = 0;
    for (const x of records) {
      const cust = await findOrCreateCustomer(x.customerName, x.person);
      await prisma.invoice.create({
        data: {
          invoiceNumber: x.invoiceNumber,
          customerId: cust.id,
          createdById: admin.id,
          status: x.status,
          dueDate: x.dueDate,
          subtotal: x.total,
          total: x.total,
          amountPaid: x.amountPaid,
          balance: x.balance,
          notes: x.notes,
          createdAt: x.date || undefined,
          sentAt: x.status !== "draft" ? x.date : null,
          paidAt: x.status === "paid" ? x.dueDate || x.date : null,
          lineItems: {
            create: {
              type: "service",
              name: x.lineName,
              description: x.lineDesc,
              quantity: 1,
              unitPrice: x.total,
              total: x.total,
              sortOrder: 0,
            },
          },
        },
      });
      created++;
    }

    const total = await prisma.invoice.count();
    console.log(`Imported ${created} invoices. Invoice table now holds ${total} rows.`);
    console.log(`Distinct customers touched: ${custCache.size}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
