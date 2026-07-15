// Parses the equipment.csv export into equipment specs. Customer/location
// resolution is left to the caller (seed.js) since it needs the live
// customerByRawName / rawNameToAddress maps built while importing
// customers.csv.
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

// "12/10/2025 0:00" -> Date. Time component is always midnight in this
// export, so only the date part matters.
function parseUsDate(s) {
  const m = (s || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const [, mo, d, y] = m;
  return new Date(Number(y), Number(mo) - 1, Number(d));
}

function parseEquipmentCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  const idx = {
    customer: header.indexOf("Customer"),
    name: header.indexOf("Equip. Name"),
    manufacturer: header.indexOf("Manufacturer"),
    model: header.indexOf("Model"),
    type: header.indexOf("Equip. Type"),
    install: header.indexOf("Install"),
    partsWarranty: header.indexOf("Parts Warranty"),
    laborWarranty: header.indexOf("Labor Warranty"),
    replaceBy: header.indexOf("Replace By"),
  };

  return rows.slice(1).map((r) => {
    const partsWarranty = parseUsDate(r[idx.partsWarranty]);
    const laborWarranty = parseUsDate(r[idx.laborWarranty]);
    return {
      customerRawName: (r[idx.customer] || "").trim().replace(/^"+|"+$/g, ""),
      name: (r[idx.name] || "").trim(),
      manufacturer: (r[idx.manufacturer] || "").trim() || null,
      model: (r[idx.model] || "").trim() || null,
      type: (r[idx.type] || "").trim() || null,
      installDate: parseUsDate(r[idx.install]),
      partsWarranty,
      laborWarranty,
      // Labor warranty is the nearer-term, more operationally relevant date
      // (contractor-backed, usually 1-2yr) vs. parts (manufacturer-backed,
      // often 10yr+); falls back to parts warranty when labor isn't given.
      warrantyExpiry: laborWarranty || partsWarranty,
      replaceBy: parseUsDate(r[idx.replaceBy]),
    };
  });
}

module.exports = { parseEquipmentCsv };
