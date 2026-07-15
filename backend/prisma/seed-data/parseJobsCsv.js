// Parses the jobs.csv export (Jobs === Work Orders in this app) into job
// specs. Customer/location resolution is left to the caller (seed.js) since
// it needs the live customerByRawName map built while importing
// customers.csv.
const fs = require("fs");
const { parseFullAddress } = require("./parseCustomersCsv");

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

// "2025-11-19 12:00 AM" -> Date (time component is always midnight in this
// export, so only the date part matters).
function parseSimpleDate(s) {
  const m = (s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

const STATUS_MAP = {
  Closed: "completed",
  "In Progress": "in_progress",
};

function parseJobsCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  const idx = {
    customer: header.indexOf("Customer"),
    address: header.indexOf("Address"),
    phone: header.indexOf("Phone"),
    status: header.indexOf("Status"),
    startDate: header.indexOf("Start Date"),
    endDate: header.indexOf("End Date"),
    projManager: header.indexOf("Proj Manager"),
  };

  return rows.slice(1).map((r) => {
    const rawAddress = (r[idx.address] || "").trim();
    return {
      customerRawName: (r[idx.customer] || "").trim().replace(/^"+|"+$/g, ""),
      address: rawAddress,
      location: parseFullAddress(rawAddress),
      phone: (r[idx.phone] || "").trim(),
      status: STATUS_MAP[(r[idx.status] || "").trim()] || "scheduled",
      originalStatus: (r[idx.status] || "").trim(),
      startDate: parseSimpleDate(r[idx.startDate]),
      endDate: parseSimpleDate(r[idx.endDate]),
      projManager: (r[idx.projManager] || "").trim(),
    };
  });
}

module.exports = { parseJobsCsv };
