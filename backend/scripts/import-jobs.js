/**
 * Job importer for a QuickBooks/FieldEdge-style export.
 *
 * CSV columns: Customer, Address, Phone, Status, Start Date, End Date,
 *              Proj Manager
 *
 * The Customer field embeds the job number as a trailing " - <n>" suffix
 * (e.g., "Fox Timothy - 1004"), which we split out. For each row we
 * find-or-create the Customer (reusing prior imports; backfilling phone and a
 * service Location) and create a Job tied to that location.
 *
 * Status: Closed -> completed, In Progress -> in_progress, else scheduled.
 * Dates: Start/End -> scheduled + actual start/end (+ completedAt when done).
 * Proj Manager is recorded in the job notes (no dedicated field).
 *
 * Existing jobs are cleared first: job-technician assignments, time entries and
 * job forms are deleted; equipment.jobId is detached.
 *
 * Usage (DATABASE_URL set):
 *   node scripts/import-jobs.js "<csvPath>" [--dry-run] [--no-clear]
 */
const fs = require("fs");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noClear = args.includes("--no-clear");
const csvPath = args.find((a) => !a.startsWith("--"));

if (!csvPath) {
  console.error('Usage: node scripts/import-jobs.js "<csvPath>" [--dry-run] [--no-clear]');
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

function mapStatus(raw) {
  const t = (raw || "").trim().toLowerCase();
  if (t === "closed" || t === "completed" || t === "complete") return "completed";
  if (t === "in progress" || t === "in-progress") return "in_progress";
  if (t === "cancelled" || t === "canceled") return "cancelled";
  if (t === "on hold") return "on_hold";
  return "scheduled";
}

// "Fox Timothy - 1004" -> { name: "Fox Timothy", jobNumber: "1004" }
function splitJobNumber(raw) {
  const m = raw.match(/^(.*?)[\s]*-[\s]*(\d+)\s*$/);
  if (m) return { name: m[1].trim(), jobNumber: m[2] };
  return { name: raw.trim(), jobNumber: null };
}

async function main() {
  const raw = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(raw).filter((r) => r.some((c) => c && c.trim() !== ""));
  const header = rows.shift().map((h) => h.trim());
  const idx = (n) => header.indexOf(n);
  const iCust = idx("Customer");
  const iAddr = idx("Address");
  const iPhone = idx("Phone");
  const iStatus = idx("Status");
  const iStart = idx("Start Date");
  const iEnd = idx("End Date");
  const iPm = idx("Proj Manager");

  const records = [];
  const seen = new Set();
  const dupes = [];
  const statusCount = {};
  let autoNum = 9000;

  for (const r of rows) {
    const rawCust = stripQuotes(r[iCust]);
    const { name: customerName, jobNumber: extracted } = splitJobNumber(rawCust);
    const jobNumber = extracted || `JOB-${autoNum++}`;
    if (seen.has(jobNumber)) {
      dupes.push(jobNumber);
      continue;
    }
    seen.add(jobNumber);

    const status = mapStatus(r[iStatus]);
    statusCount[status] = (statusCount[status] || 0) + 1;

    records.push({
      jobNumber,
      customerName,
      person: parseName(customerName),
      addr: parseAddress(r[iAddr]),
      phone: (r[iPhone] || "").trim(),
      status,
      start: parseDate(r[iStart]),
      end: parseDate(r[iEnd]),
      pm: (r[iPm] || "").trim(),
    });
  }

  console.log("── Parse report ─────────────────────────────────────────────");
  console.log(`CSV rows (excl. header):  ${rows.length}`);
  console.log(`Importable jobs:          ${records.length}`);
  console.log(`Duplicate job #s:         ${dupes.length}${dupes.length ? " (" + dupes.join(", ") + ")" : ""}`);
  console.log(`Distinct customers:       ${new Set(records.map((r) => r.customerName)).size}`);
  console.log(`Mapped status counts:     ${JSON.stringify(statusCount)}`);
  console.log("Samples (first 5):");
  for (const x of records.slice(0, 5)) {
    const disp = x.person.companyName || `${x.person.firstName} ${x.person.lastName}`.trim();
    console.log(`  #${x.jobNumber} | ${disp} [${x.person.type}] | ${x.phone} | ${x.status} | ${x.start ? x.start.toISOString().slice(0, 10) : "-"}→${x.end ? x.end.toISOString().slice(0, 10) : "-"} | ${x.addr.city} ${x.addr.state}`);
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
    if (!admin) throw new Error("No admin user found to own the jobs.");

    if (!noClear) {
      await prisma.jobTechnician.deleteMany({});
      await prisma.timeEntry.deleteMany({});
      await prisma.jobForm.deleteMany({});
      await prisma.equipment.updateMany({ where: { jobId: { not: null } }, data: { jobId: null } });
      const del = await prisma.job.deleteMany({});
      console.log(`Cleared ${del.count} existing jobs (assignments/time/forms removed, equipment detached).`);
    }

    const existingNumbers = new Set(
      (await prisma.customer.findMany({ select: { customerNumber: true } })).map((c) => c.customerNumber),
    );
    let seq = 5001;
    const nextCustomerNumber = () => {
      let n;
      do {
        n = `CUST-${seq++}`;
      } while (existingNumbers.has(n));
      existingNumbers.add(n);
      return n;
    };

    const custCache = new Map();
    async function findOrCreateCustomer(name, person, phone) {
      if (custCache.has(name)) return custCache.get(name);
      const where = person.type === "commercial" ? { companyName: name } : { firstName: person.firstName, lastName: person.lastName };
      let cust = await prisma.customer.findFirst({ where });
      if (!cust) {
        cust = await prisma.customer.create({
          data: {
            customerNumber: nextCustomerNumber(),
            firstName: person.firstName || "",
            lastName: person.lastName || name,
            phone: phone || "",
            type: person.type,
            companyName: person.companyName,
            source: "import",
          },
        });
      } else if (phone && (!cust.phone || cust.phone.trim() === "")) {
        cust = await prisma.customer.update({ where: { id: cust.id }, data: { phone } });
      }
      custCache.set(name, cust);
      return cust;
    }

    async function findOrCreateLocation(customerId, addr) {
      if (!addr.address) return null;
      let loc = await prisma.location.findFirst({ where: { customerId, address: addr.address } });
      if (!loc) {
        loc = await prisma.location.create({
          data: {
            customerId,
            name: "Service Address",
            address: addr.address,
            city: addr.city,
            state: addr.state,
            zip: addr.zip,
            type: "service",
            isPrimary: true,
          },
        });
      }
      return loc.id;
    }

    let created = 0;
    for (const x of records) {
      const cust = await findOrCreateCustomer(x.customerName, x.person, x.phone);
      const locationId = await findOrCreateLocation(cust.id, x.addr);
      const done = x.status === "completed";
      await prisma.job.create({
        data: {
          jobNumber: x.jobNumber,
          customerId: cust.id,
          locationId,
          createdById: admin.id,
          type: "service",
          status: x.status,
          summary: x.customerName,
          notes: x.pm ? `Project Manager: ${x.pm}` : null,
          scheduledStart: x.start,
          scheduledEnd: x.end,
          actualStart: x.status !== "scheduled" ? x.start : null,
          actualEnd: done ? x.end : null,
          completedAt: done ? x.end : null,
          createdAt: x.start || undefined,
        },
      });
      created++;
    }

    const total = await prisma.job.count();
    console.log(`Imported ${created} jobs. Job table now holds ${total} rows.`);
    console.log(`Distinct customers touched: ${custCache.size}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
