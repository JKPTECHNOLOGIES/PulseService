/**
 * Service-agreement importer for a QuickBooks/FieldEdge-style export.
 *
 * CSV columns: Customer, Agreement, Agreement Plan, Next Service Date,
 *              Next Invoice Date, Address
 *
 * For each row we:
 *   - find-or-create a Customer from the name (residential vs commercial
 *     heuristic) and attach the service Address as a primary Location;
 *   - create a ServiceAgreement (agreementNumber = "Agreement");
 *   - create one AgreementVisit for the "Next Service Date".
 *
 * Derived fields (not in the CSV) — see the notes printed at the end:
 *   name             <- plan expansion ("PSA" => "Planned Service Agreement")
 *   billingFrequency <- "annually" (assumption)
 *   amount           <- 0 (not provided in the CSV)
 *   nextBillingDate  <- Next Invoice Date
 *   endDate          <- Next Invoice Date (fallback: Next Service Date / +1y)
 *   startDate        <- endDate minus one year
 *   status/autoRenew <- "active" / true
 *
 * Usage (DATABASE_URL set):
 *   node scripts/import-agreements.js "<csvPath>" [--dry-run] [--no-clear]
 */
const fs = require("fs");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noClear = args.includes("--no-clear");
const csvPath = args.find((a) => !a.startsWith("--"));

if (!csvPath) {
  console.error('Usage: node scripts/import-agreements.js "<csvPath>" [--dry-run] [--no-clear]');
  process.exit(1);
}

const PLAN_NAMES = { PSA: "Planned Service Agreement" };
const planToName = (p) => PLAN_NAMES[p] || `${p} Service Agreement`;

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

function parseDate(s) {
  const t = (s || "").trim();
  if (!t) return null;
  const d = new Date(`${t}T00:00:00.000Z`);
  return isNaN(d.getTime()) ? null : d;
}

// Strong company indicators (deliberately excludes ambiguous tokens like
// "Tower"/"A/C" that appear as suffixes on residential person accounts).
const COMMERCIAL =
  /\b(LLC|L\.L\.C|Inc|Incorporated|Corp|Company|Trust|Club|CC|Dentistry|Dental|Confections|Salon|Hair|Reserve|Sailfish|Golf|Storage|Residence)\b/i;

function parseName(raw) {
  const name = raw.trim();
  if (COMMERCIAL.test(name)) {
    return { type: "commercial", firstName: "", lastName: name, companyName: name };
  }
  if (name.includes(",")) {
    const idx = name.indexOf(",");
    return {
      type: "residential",
      lastName: name.slice(0, idx).trim(),
      firstName: name.slice(idx + 1).trim(),
      companyName: null,
    };
  }
  if (/^\d/.test(name) || name.includes("/")) {
    return { type: "commercial", firstName: "", lastName: name, companyName: name };
  }
  const words = name.split(/\s+/);
  if (words.length >= 2) {
    return {
      type: "residential",
      lastName: words[0],
      firstName: words.slice(1).join(" "),
      companyName: null,
    };
  }
  return { type: "residential", firstName: "", lastName: name, companyName: null };
}

function parseAddress(raw) {
  const s = (raw || "").trim();
  if (!s) return { address: "", city: "", state: "", zip: "" };
  const dash = s.lastIndexOf(" - ");
  if (dash < 0) return { address: s, city: "", state: "", zip: "" };
  const address = s.slice(0, dash).trim();
  const locality = s.slice(dash + 3).trim();
  const tokens = locality.split(/\s+/);
  const zip = (tokens[tokens.length - 1] || "").replace(/[^0-9]/g, "");
  const state = (tokens[tokens.length - 2] || "").replace(/[^A-Za-z]/g, "").toUpperCase();
  const city = tokens.slice(0, Math.max(0, tokens.length - 2)).join(" ");
  return { address, city, state, zip };
}

async function main() {
  const raw = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(raw).filter((r) => r.some((c) => c && c.trim() !== ""));
  const header = rows.shift().map((h) => h.trim());
  const idx = (n) => header.indexOf(n);
  const iCust = idx("Customer");
  const iAgr = idx("Agreement");
  const iPlan = idx("Agreement Plan");
  const iSvc = idx("Next Service Date");
  const iInv = idx("Next Invoice Date");
  const iAddr = idx("Address");

  const records = [];
  const seenAgr = new Set();
  const dupes = [];
  const plans = {};
  let residential = 0;
  let commercial = 0;

  for (const r of rows) {
    const agreementNumber = (r[iAgr] || "").trim();
    if (!agreementNumber) continue;
    if (seenAgr.has(agreementNumber)) {
      dupes.push(agreementNumber);
      continue;
    }
    seenAgr.add(agreementNumber);

    const customerName = stripQuotes(r[iCust]);
    const plan = (r[iPlan] || "").trim();
    const nextService = parseDate(r[iSvc]);
    const nextInvoice = parseDate(r[iInv]);
    const person = parseName(customerName);
    const addr = parseAddress(r[iAddr]);

    plans[plan || "(blank)"] = (plans[plan || "(blank)"] || 0) + 1;
    if (person.type === "commercial") commercial++;
    else residential++;

    const endDate = nextInvoice || nextService || new Date(Date.now() + 365 * 864e5);
    const startDate = new Date(endDate);
    startDate.setFullYear(startDate.getFullYear() - 1);

    records.push({
      agreementNumber,
      customerName,
      person,
      addr,
      plan,
      name: planToName(plan),
      startDate,
      endDate,
      nextBillingDate: nextInvoice,
      nextService,
    });
  }

  console.log("── Parse report ─────────────────────────────────────────────");
  console.log(`CSV rows (excl. header):    ${rows.length}`);
  console.log(`Importable agreements:      ${records.length}`);
  console.log(`Duplicate agreement #s:     ${dupes.length}${dupes.length ? " (" + dupes.join(", ") + ")" : ""}`);
  console.log(`Customers residential/comm: ${residential} / ${commercial}`);
  console.log(`By plan:                    ${JSON.stringify(plans)}`);
  console.log("Samples (first 4):");
  for (const x of records.slice(0, 4)) {
    const disp = x.person.companyName || `${x.person.firstName} ${x.person.lastName}`.trim();
    console.log(
      `  #${x.agreementNumber} ${x.plan} | ${disp} [${x.person.type}] | ${x.addr.city} ${x.addr.state} ${x.addr.zip} | term ${x.startDate.toISOString().slice(0, 10)}→${x.endDate.toISOString().slice(0, 10)} | nextSvc ${x.nextService ? x.nextService.toISOString().slice(0, 10) : "-"}`,
    );
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
      const del = await prisma.serviceAgreement.deleteMany({}); // visits cascade
      console.log(`Cleared ${del.count} existing agreements (visits cascaded).`);
    }

    // Unique customerNumber generator that avoids existing numbers.
    const existingNumbers = new Set(
      (await prisma.customer.findMany({ select: { customerNumber: true } })).map((c) => c.customerNumber),
    );
    let seq = 2001;
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
      const where =
        person.type === "commercial"
          ? { companyName: name }
          : { firstName: person.firstName, lastName: person.lastName };
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
              ? {
                  create: {
                    name: "Service Address",
                    address: addr.address,
                    city: addr.city,
                    state: addr.state,
                    zip: addr.zip,
                    type: "service",
                    isPrimary: true,
                  },
                }
              : undefined,
          },
        });
      }
      custCache.set(name, cust);
      return cust;
    }

    let created = 0;
    for (const x of records) {
      const cust = await findOrCreateCustomer(x.customerName, x.person, x.addr);
      await prisma.serviceAgreement.create({
        data: {
          agreementNumber: x.agreementNumber,
          customerId: cust.id,
          name: x.name,
          status: "active",
          startDate: x.startDate,
          endDate: x.endDate,
          billingFrequency: "annually",
          amount: 0,
          autoRenew: true,
          nextBillingDate: x.nextBillingDate,
          notes: `Imported plan: ${x.plan}`,
          visits: x.nextService
            ? {
                create: {
                  name: "Next scheduled service",
                  scheduledDate: x.nextService,
                  status: "pending",
                },
              }
            : undefined,
        },
      });
      created++;
    }

    const total = await prisma.serviceAgreement.count();
    console.log(`Imported ${created} agreements. ServiceAgreement now holds ${total} rows.`);
    console.log(`Customers created this run: ${custCache.size}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
