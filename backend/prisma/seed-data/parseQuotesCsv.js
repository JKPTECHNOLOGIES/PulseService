// Parses the quotes.csv export into estimate specs. Customer resolution is
// left to the caller (seed.js) since it needs the live customerByRawName
// map built while importing customers.csv — this module just normalizes the
// raw rows.
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

// "2025-08-21 12:00 AM" -> Date (time component is always midnight in this
// export, so only the date part matters).
function parseSimpleDate(s) {
  const m = (s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

const STATUS_MAP = {
  Scheduled: "approved",
  Accepted: "approved",
  Pending: "sent",
  Rejected: "rejected",
};

function parseQuotesCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  const idx = {
    customer: header.indexOf("Customer"),
    address: header.indexOf("Address"),
    quoteNum: header.indexOf("Quote #"),
    quoteDate: header.indexOf("Quote Date"),
    status: header.indexOf("Status"),
    expDate: header.indexOf("Expiration Date"),
    amount: header.indexOf("Amount"),
    multiOption: header.indexOf("Multi-Option"),
    printed: header.indexOf("Printed"),
    emailed: header.indexOf("Emailed"),
  };

  return rows.slice(1).map((r) => ({
    customerRawName: (r[idx.customer] || "").trim().replace(/^"+|"+$/g, ""),
    address: (r[idx.address] || "").trim(),
    quoteNumber: (r[idx.quoteNum] || "").trim(),
    quoteDate: parseSimpleDate(r[idx.quoteDate]),
    status: STATUS_MAP[(r[idx.status] || "").trim()] || "sent",
    originalStatus: (r[idx.status] || "").trim(),
    expirationDate: parseSimpleDate(r[idx.expDate]),
    amount: parseFloat(r[idx.amount]) || 0,
    multiOption: /^true$/i.test((r[idx.multiOption] || "").trim()),
    printed: /^true$/i.test((r[idx.printed] || "").trim()),
    emailed: /^true$/i.test((r[idx.emailed] || "").trim()),
  }));
}

module.exports = { parseQuotesCsv };
