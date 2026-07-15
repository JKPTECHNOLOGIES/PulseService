// Parses the invoices.csv export into invoice specs. Customer resolution is
// left to the caller (seed.js) since it needs the live customerByRawName
// map built while importing customers.csv. There's no reliable way to link
// the "WO #" column back to our imported jobs (our jobs.csv import didn't
// preserve the original system's work-order IDs, and this export's WO #
// values are those original IDs), so jobId is intentionally left unset —
// the original WO # and description are preserved in notes instead.
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

// "2026-01-14 12:00 AM" or "2026-07-10 08:39 PM" -> Date. Most rows in this
// export are midnight-only dates, but a handful of very recent ones carry a
// real time-of-day, so parse the full HH:MM AM/PM instead of assuming noon.
function parseDateTime(s) {
  const m = (s || "").match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{1,2}):(\d{2}) (AM|PM)$/,
  );
  if (!m) return null;
  const [, y, mo, d, hRaw, min, ampm] = m;
  let h = Number(hRaw) % 12;
  if (ampm === "PM") h += 12;
  return new Date(Number(y), Number(mo) - 1, Number(d), h, Number(min));
}

// QuickBooks Enterprise exports embed a literal "\CR" as a line-break
// placeholder inside long-text fields; turn it into a real newline.
function cleanText(s) {
  return (s || "").replace(/\\CR/g, "\n").trim();
}

const STATUS_MAP = {
  "NON-BILLABLE": "paid", // $0 total/balance on every row - nothing ever owed
  OVERDUE: "overdue",
  DUE: "sent",
  PENDING: "sent",
  PAID: "paid",
};

function parseInvoicesCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  const idx = {
    customer: header.indexOf("Customer"),
    wo: header.indexOf("WO #"),
    invoiceNum: header.indexOf("Invoice #"),
    date: header.indexOf("Date"),
    dueDate: header.indexOf("Due Date"),
    total: header.indexOf("Total"),
    balance: header.indexOf("Balance"),
    payStatus: header.indexOf("Invoice Pay Status"),
    woDescription: header.indexOf("WO Description"),
    summary: header.indexOf("Summary"),
  };

  return rows.slice(1).map((r) => {
    const total = parseFloat(r[idx.total]) || 0;
    const balance = parseFloat(r[idx.balance]) || 0;
    return {
      customerRawName: (r[idx.customer] || "").trim().replace(/^"+|"+$/g, ""),
      wo: (r[idx.wo] || "").trim(),
      invoiceNumber: (r[idx.invoiceNum] || "").trim(),
      date: parseDateTime(r[idx.date]),
      dueDate: parseDateTime(r[idx.dueDate]),
      total,
      balance,
      amountPaid: total - balance,
      status: STATUS_MAP[(r[idx.payStatus] || "").trim()] || "sent",
      originalStatus: (r[idx.payStatus] || "").trim(),
      woDescription: cleanText(r[idx.woDescription]),
      summary: cleanText(r[idx.summary]),
    };
  });
}

module.exports = { parseInvoicesCsv };
