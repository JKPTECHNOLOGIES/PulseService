// Parses workOrders.csv (Jobs === Work Orders in this app) into job specs.
// Customer/location/technician resolution is left to the caller (seed.js)
// since they need the live customerByRawName map and the seeded user/tech
// roster.
//
// Key structural fact about this export: a single work order (WO#) can have
// MULTIPLE rows — same customer, same invoice, just different scheduled
// visits (a reschedule, or a multi-day job). We group rows by WO# into one
// job per group; the earliest visit becomes the job's primary
// scheduledStart, and any additional visits become JobScheduleBlock entries
// (the schema has this exact concept: "a job that runs long or needs a
// return visit accrues extra blocks here"). The LATEST visit in the group is
// treated as authoritative for status/technician/summary/description, since
// it's the most likely to reflect the outcome.
const fs = require("fs");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // ignore; \n below closes the row
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.length > 1 || (r[0] && r[0].trim() !== ""));
}

// "2026-01-13 01:00 PM" -> Date.
function parseDateTime(s) {
  const m = (s || "").trim().match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2}) (AM|PM)$/,
  );
  if (!m) return null;
  const [, y, mo, d, hRaw, min, ampm] = m;
  let h = Number(hRaw) % 12;
  if (ampm === "PM") h += 12;
  return new Date(Number(y), Number(mo) - 1, Number(d), h, Number(min));
}

function cleanText(s) {
  return (s || "").replace(/\\CR/g, "\n").trim();
}

const STATUS_MAP = {
  Finalized: "completed",
  Complete: "completed",
  Canceled: "cancelled",
  Scheduled: "scheduled",
  Pending: "new",
  "Partially Complete": "in_progress",
};

// Task carries both a business segment (Residential/Commercial) and a work
// category (PSA/LMC/IMC/RSC/PM are all recurring-maintenance-plan visit
// types). Job.type is a constrained lookup, so we map it here; the raw Task
// string itself is preserved verbatim (via the job spec's `task` field ->
// Job.tags in seed.js) since it carries more nuance than the lookup allows.
const TASK_TYPE_MAP = {
  "Residential Install": "installation",
  "Commercial Install": "installation",
  "Residential Service": "service",
  "Commercial Service": "service",
  "Cap Report": "inspection",
  "Commercial Repair Parts": "repair",
  "Residential Repair Parts": "repair",
  "Residential PSA": "maintenance",
  "Residential LMC": "maintenance",
  "Commercial IMC": "maintenance",
  "Commercial LMC": "maintenance",
  "Commercial RSC": "maintenance",
  "Water Treatment Service": "maintenance",
  "Ice Machine PM": "maintenance",
  "Ventilation PM": "maintenance",
  "Refrigeration PM": "maintenance",
  "Chiller / Tower Service": "maintenance",
  "ID/AC/FC": "maintenance",
  "Commercial F/C": "maintenance",
};

function parseWorkOrdersCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  const idx = {
    customer: header.indexOf("Customer"),
    wo: header.indexOf("WO#"),
    invoice: header.indexOf("Invoice"),
    quote: header.indexOf("Quote"),
    task: header.indexOf("Task"),
    status: header.indexOf("Status"),
    scheduled: header.indexOf("Scheduled Date"),
    technician: header.indexOf("Technician"),
    summary: header.indexOf("Summary"),
    woDescription: header.indexOf("WO Description"),
    purchaseOrder: header.indexOf("Purchase Order"),
    dateAdded: header.indexOf("Date Added"),
    completedDate: header.indexOf("Completed Date"),
  };

  const rawRows = rows.slice(1).map((r) => ({
    customerRawName: (r[idx.customer] || "").trim().replace(/^"+|"+$/g, ""),
    wo: (r[idx.wo] || "").trim(),
    invoice: (r[idx.invoice] || "").trim(),
    quote: (r[idx.quote] || "").trim(),
    task: (r[idx.task] || "").trim(),
    status: (r[idx.status] || "").trim(),
    scheduled: parseDateTime(r[idx.scheduled]),
    technician: (r[idx.technician] || "").trim() || null,
    summary: cleanText(r[idx.summary]),
    description: cleanText(r[idx.woDescription]),
    purchaseOrder: (r[idx.purchaseOrder] || "").trim() || null,
    dateAdded: parseDateTime(r[idx.dateAdded]),
    completedDate: parseDateTime(r[idx.completedDate]),
  }));

  // Group by WO#.
  const groups = new Map();
  for (const r of rawRows) {
    if (!groups.has(r.wo)) groups.set(r.wo, []);
    groups.get(r.wo).push(r);
  }

  const jobs = [];
  for (const [wo, visits] of groups) {
    visits.sort((a, b) => {
      const at = a.scheduled ? a.scheduled.getTime() : 0;
      const bt = b.scheduled ? b.scheduled.getTime() : 0;
      return at - bt;
    });
    const first = visits[0];
    const last = visits[visits.length - 1];

    const completedDates = visits
      .map((v) => v.completedDate)
      .filter(Boolean)
      .sort((a, b) => a.getTime() - b.getTime());
    const completedAt = completedDates.length
      ? completedDates[completedDates.length - 1]
      : null;

    const dateAddedValues = visits
      .map((v) => v.dateAdded)
      .filter(Boolean)
      .sort((a, b) => a.getTime() - b.getTime());

    jobs.push({
      wo,
      customerRawName: last.customerRawName,
      status: STATUS_MAP[last.status] || "new",
      originalStatus: last.status,
      task: last.task,
      type: TASK_TYPE_MAP[last.task] || "service",
      invoiceRef: last.invoice || null,
      quoteRef: last.quote || null,
      purchaseOrder: last.purchaseOrder,
      technicianName: last.technician,
      summary: last.summary,
      description: last.description,
      scheduledStart: first.scheduled,
      scheduledEnd: last.scheduled,
      completedAt,
      createdAt: dateAddedValues[0] || first.scheduled,
      // Every visit in the group, chronologically -- seed.js uses [0] as the
      // primary scheduledStart and the rest as JobScheduleBlock entries.
      visits,
    });
  }

  return jobs;
}

module.exports = { parseWorkOrdersCsv };
