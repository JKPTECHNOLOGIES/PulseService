/**
 * Customer master-list importer (merge/enrich) for a QuickBooks/FieldEdge-style
 * export.
 *
 * CSV columns: Display Name, Customer Type, Full Address, Phone, Email,
 *              Lead Source
 *
 * This is intentionally NON-destructive: customers created by the other imports
 * (agreements/quotes/invoices/jobs) are matched by the same name heuristic and
 * ENRICHED (phone, email, lead source, service Location). Rows with no existing
 * match are created. Nothing is deleted (clear the seed demo customers
 * separately). A trailing " - <number>" (work-order contamination) is stripped
 * from the display name so it dedupes to the real customer.
 *
 * Usage (DATABASE_URL set):
 *   node scripts/import-customers.js "<csvPath>" [--dry-run]
 */
const fs = require("fs");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const csvPath = args.find((a) => !a.startsWith("--"));

if (!csvPath) {
  console.error('Usage: node scripts/import-customers.js "<csvPath>" [--dry-run]');
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
const stripJobSuffix = (s) => s.replace(/\s*-\s*\d+\s*$/, "").trim();

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

function parseAddress(raw) {
  const s = (raw || "").trim();
  if (!s) return { address: "", city: "", state: "", zip: "" };
  const dash = s.lastIndexOf(" - ");
  const [addressPart, locality] = dash >= 0 ? [s.slice(0, dash).trim(), s.slice(dash + 3).trim()] : [s, ""];
  const tokens = (locality || "").split(/\s+/).filter(Boolean);
  return {
    address: addressPart,
    zip: (tokens[tokens.length - 1] || "").replace(/[^0-9]/g, ""),
    state: (tokens[tokens.length - 2] || "").replace(/[^A-Za-z]/g, "").toUpperCase(),
    city: tokens.slice(0, Math.max(0, tokens.length - 2)).join(" "),
  };
}

async function main() {
  const raw = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(raw).filter((r) => r.some((c) => c && c.trim() !== ""));
  const header = rows.shift().map((h) => h.trim());
  const idx = (n) => header.indexOf(n);
  const iName = idx("Display Name");
  const iAddr = idx("Full Address");
  const iPhone = idx("Phone");
  const iEmail = idx("Email");
  const iLead = idx("Lead Source");

  const records = [];
  const seen = new Set();
  let dupes = 0;

  for (const r of rows) {
    const display = stripJobSuffix(stripQuotes(r[iName]));
    if (!display) continue;
    if (seen.has(display)) {
      dupes++;
      continue;
    }
    seen.add(display);
    records.push({
      display,
      person: parseName(display),
      addr: parseAddress(r[iAddr]),
      phone: (r[iPhone] || "").trim(),
      email: (r[iEmail] || "").trim(),
      source: (r[iLead] || "").trim(),
    });
  }

  console.log("── Parse report ─────────────────────────────────────────────");
  console.log(`CSV rows (excl. header):  ${rows.length}`);
  console.log(`Importable customers:     ${records.length}`);
  console.log(`Duplicate display names:  ${dupes}`);
  const comm = records.filter((r) => r.person.type === "commercial").length;
  console.log(`Residential / commercial: ${records.length - comm} / ${comm}`);
  console.log(`With phone / email:       ${records.filter((r) => r.phone).length} / ${records.filter((r) => r.email).length}`);
  console.log("Samples (first 4):");
  for (const x of records.slice(0, 4)) {
    const disp = x.person.companyName || `${x.person.firstName} ${x.person.lastName}`.trim();
    console.log(`  ${disp} [${x.person.type}] | ${x.phone || "-"} | ${x.email || "-"} | ${x.source || "-"} | ${x.addr.city} ${x.addr.state}`);
  }
  console.log("─────────────────────────────────────────────────────────────");

  if (dryRun) {
    console.log("DRY RUN — no database changes made.");
    return;
  }

  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const existingNumbers = new Set(
      (await prisma.customer.findMany({ select: { customerNumber: true } })).map((c) => c.customerNumber),
    );
    let seq = 6001;
    const nextCustomerNumber = () => {
      let n;
      do {
        n = `CUST-${seq++}`;
      } while (existingNumbers.has(n));
      existingNumbers.add(n);
      return n;
    };

    async function ensureLocation(customerId, addr) {
      if (!addr.address) return;
      const loc = await prisma.location.findFirst({ where: { customerId, address: addr.address } });
      if (!loc) {
        await prisma.location.create({
          data: { customerId, name: "Service Address", address: addr.address, city: addr.city, state: addr.state, zip: addr.zip, type: "service", isPrimary: true },
        });
      }
    }

    let created = 0;
    let updated = 0;
    for (const x of records) {
      const { person } = x;
      const where = person.type === "commercial" ? { companyName: x.display } : { firstName: person.firstName, lastName: person.lastName };
      let cust = await prisma.customer.findFirst({ where });
      if (cust) {
        const data = {};
        if (x.phone) data.phone = x.phone;
        if (x.email) data.email = x.email;
        if (x.source) data.source = x.source;
        if (Object.keys(data).length) {
          cust = await prisma.customer.update({ where: { id: cust.id }, data });
        }
        updated++;
      } else {
        cust = await prisma.customer.create({
          data: {
            customerNumber: nextCustomerNumber(),
            firstName: person.firstName || "",
            lastName: person.lastName || x.display,
            phone: x.phone || "",
            email: x.email || null,
            type: person.type,
            companyName: person.companyName,
            source: x.source || "import",
          },
        });
        created++;
      }
      await ensureLocation(cust.id, x.addr);
    }

    console.log(`Merged customers — created: ${created}, updated (enriched): ${updated}.`);
    console.log(`Customer table now holds ${await prisma.customer.count()} rows.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
