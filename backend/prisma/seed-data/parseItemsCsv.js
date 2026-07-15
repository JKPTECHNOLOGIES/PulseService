// Minimal RFC4180-ish CSV parser (handles quoted fields, embedded commas,
// escaped "" quotes, and CRLF/LF line endings) used to load the real
// parts/equipment catalog exported from QuickBooks (`pricebook-items.csv`)
// at seed time. No third-party dependency needed for a file this shape.
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

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // ignore; \n (or end of input) below closes the row
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // Last field/row (file may or may not end with a newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.length > 1 || (r[0] && r[0].trim() !== ""));
}

// Reads the QuickBooks "Items" export and returns normalized rows:
// { itemName, description, mfgPartNumber, category, rate, itemType }
function parseItemsCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  const idx = {
    itemName: header.indexOf("Item Name"),
    description: header.indexOf("Description"),
    mfgPartNumber: header.indexOf("Mfg Part #"),
    category: header.indexOf("Category"),
    rate: header.indexOf("Rate"),
    itemType: header.indexOf("Item Type"),
  };

  return rows.slice(1).map((r) => ({
    itemName: (r[idx.itemName] || "").trim(),
    description: (r[idx.description] || "").trim(),
    mfgPartNumber: (r[idx.mfgPartNumber] || "").trim(),
    category: (r[idx.category] || "").trim(),
    rate: parseFloat(r[idx.rate]) || 0,
    itemType: (r[idx.itemType] || "").trim(),
  }));
}

module.exports = { parseItemsCsv };
