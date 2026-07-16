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

// "2025-12-10 12:00 AM" -> Date. Time component is always midnight in this
// export, so only the date part matters.
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
    comments: header.indexOf("Comments"),
    additionalInfo: header.indexOf("Additional Info"),
    serialNumber: header.indexOf("Serial Number"),
  };

  return rows.slice(1).map((r) => {
    const partsWarranty = parseDateTime(r[idx.partsWarranty]);
    const laborWarranty = parseDateTime(r[idx.laborWarranty]);
    return {
      customerRawName: (r[idx.customer] || "").trim().replace(/^"+|"+$/g, ""),
      name: (r[idx.name] || "").trim(),
      manufacturer: (r[idx.manufacturer] || "").trim() || null,
      model: (r[idx.model] || "").trim() || null,
      type: (r[idx.type] || "").trim() || null,
      serialNumber: (r[idx.serialNumber] || "").trim() || null,
      // "Comments" is a manufacturer/spec description of the model (distinct
      // from "Additional Info", which is where/how this specific unit was
      // installed) -> Equipment.description / Equipment.notes respectively.
      description: (r[idx.comments] || "").trim() || null,
      notes: (r[idx.additionalInfo] || "").trim() || null,
      installDate: parseDateTime(r[idx.install]),
      partsWarranty,
      laborWarranty,
      // Labor warranty is the nearer-term, more operationally relevant date
      // (contractor-backed, usually 1-2yr) -- what the app's single Warranty
      // badge/filter keys off of -- falling back to parts warranty (usually
      // much longer, manufacturer-backed) when labor isn't given. Parts is
      // also kept in full alongside it as its own field.
      warrantyExpiry: laborWarranty || partsWarranty,
      partsWarrantyExpiry: partsWarranty,
      replaceBy: parseDateTime(r[idx.replaceBy]),
    };
  });
}

module.exports = { parseEquipmentCsv };
