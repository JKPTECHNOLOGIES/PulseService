// Parses the (deduplicated) customers.csv export and turns it into a list of
// customer specs ready to feed to `prisma.customer.create` — including
// splitting "Full Address" into address/city/state/zip, guessing
// firstName/lastName from "Display Name", and folding known multi-property
// customers (see customerMerges.js) into a single customer with multiple
// locations instead of one customer per row.
const fs = require("fs");
const CUSTOMER_MERGES = require("./customerMerges");

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

// "123 Main St - Palm Beach FL 33480" -> { address, city, state, zip }
// Handles: full state names ("Florida"), missing state, missing zip, and
// garbage stuck to the end of a zip code (e.g. "33487Mark").
function parseFullAddress(full) {
  const addr = (full || "").trim();
  if (!addr) return null;

  const dashIdx = addr.indexOf(" - ");
  if (dashIdx === -1) {
    return { address: addr, city: "", state: "FL", zip: "" };
  }
  const address = addr.slice(0, dashIdx).trim();
  let rest = addr.slice(dashIdx + 3).trim();

  const zipMatches = [...rest.matchAll(/\d{5}(-\d{4})?/g)];
  let zip = "";
  if (zipMatches.length > 0) {
    const last = zipMatches[zipMatches.length - 1];
    zip = last[0];
    rest = rest.slice(0, last.index).trim();
  }

  let state = "";
  const words = rest.split(/\s+/).filter(Boolean);
  const lastWord = words[words.length - 1] || "";
  if (/^florida$/i.test(lastWord)) {
    state = "FL";
    words.pop();
  } else if (/^[A-Za-z]{2}\.?$/.test(lastWord)) {
    state = lastWord.replace(/\./, "").toUpperCase();
    words.pop();
  }
  if (!state) state = "FL"; // dataset is ~100% FL; explicit 2-letter codes above still win

  const city = words.join(" ").replace(/[,.\s]+$/, "").trim();
  return { address, city, state, zip };
}

const BUSINESS_WORD_RE =
  /\b(LLC|INC|CORP|CO\.?|COMPANY|CLUB|ASSOCIATION|TRUST|RESIDENCE|CONSTRUCTION|MANAGEMENT|GROUP|CENTER|PROPERTIES|HOMEOWNERS|REALTY|ENTERPRISES|HOLDINGS|MANUFACTURING|WARR|COUNTRY CLUB|FOUNDATION|CHURCH|SCHOOL|PARTNERS|VENTURES|LTD|HEALTH)\b/i;

function looksLikeBusiness(name, customerType) {
  if (customerType === "Commercial" || customerType === "Property Manager")
    return true;
  if (/^\d/.test(name)) return true; // e.g. "100 Emerald Beach Way"
  return BUSINESS_WORD_RE.test(name);
}

// Splits a cleaned Display Name into { firstName, lastName, companyName }.
function splitName(rawName, customerType) {
  const name = rawName.trim().replace(/^"+|"+$/g, "");
  const isBusiness = looksLikeBusiness(name, customerType);

  const commaIdx = name.indexOf(",");
  if (commaIdx !== -1) {
    const lastName = name.slice(0, commaIdx).trim();
    const firstName = name.slice(commaIdx + 1).trim();
    return {
      firstName,
      lastName,
      companyName: isBusiness ? name : null,
    };
  }

  const words = name.split(/\s+/).filter(Boolean);
  if (words.length <= 1) {
    return { firstName: "", lastName: name, companyName: isBusiness ? name : null };
  }

  if (isBusiness) {
    // Split at the LAST space so "{firstName} {lastName}" reconstructs the
    // original business name exactly for display.
    const lastName = words[words.length - 1];
    const firstName = words.slice(0, -1).join(" ");
    return { firstName, lastName, companyName: name };
  }

  // Personal name, no comma: source convention is "Lastname Firstname...".
  const lastName = words[0];
  const firstName = words.slice(1).join(" ");
  return { firstName, lastName, companyName: null };
}

function mapCustomerType(csvType) {
  if (csvType === "Commercial") return "commercial";
  if (csvType === "Property Manager") return "commercial";
  if (csvType === "Residential") return "residential";
  return null; // decided later from looksLikeBusiness() when blank
}

function parseCustomersCsv(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim());
  const idx = {
    name: header.indexOf("Display Name"),
    type: header.indexOf("Customer Type"),
    address: header.indexOf("Full Address"),
    phone: header.indexOf("Phone"),
    email: header.indexOf("Email"),
    source: header.indexOf("Lead Source"),
  };

  // Full Address (exact text) -> merge group, so rows belonging to a known
  // multi-property customer get routed together instead of becoming their
  // own separate customer.
  const addressToMerge = new Map();
  for (const merge of CUSTOMER_MERGES) {
    for (const addr of merge.addresses) addressToMerge.set(addr, merge);
  }

  const mergeGroupsUsed = new Map(); // merge.key -> accumulated customer spec
  const customers = [];

  for (const r of rows.slice(1)) {
    const rawName = (r[idx.name] || "").trim();
    const csvType = (r[idx.type] || "").trim();
    const fullAddress = (r[idx.address] || "").trim();
    const phone = (r[idx.phone] || "").trim();
    const email = (r[idx.email] || "").trim();
    const source = (r[idx.source] || "").trim() || null;

    const location = parseFullAddress(fullAddress);
    const merge = addressToMerge.get(fullAddress);
    const cleanRawName = rawName.replace(/^"+|"+$/g, "").trim();

    if (merge) {
      let spec = mergeGroupsUsed.get(merge.key);
      if (!spec) {
        spec = {
          firstName: merge.firstName,
          lastName: merge.lastName,
          companyName: merge.companyName || null,
          type: merge.type,
          phone: merge.phone,
          email: merge.email,
          source: merge.source || null,
          locations: [],
          // Every raw Display Name / Full Address that feeds into this
          // customer, so other CSV imports (e.g. quotes) that reference the
          // customer by its original per-row name can resolve it too.
          sourceNames: [],
          sourceAddresses: [],
          // raw Display Name (normalized-ready, pre-lowercasing) -> the exact
          // Full Address that name was tied to, so other importers (e.g.
          // equipment) can pick the right one of this customer's several
          // locations instead of just defaulting to the first.
          nameToAddress: {},
        };
        mergeGroupsUsed.set(merge.key, spec);
        customers.push(spec);
      }
      if (location) spec.locations.push(location);
      spec.sourceNames.push(cleanRawName);
      if (fullAddress) {
        spec.sourceAddresses.push(fullAddress);
        spec.nameToAddress[cleanRawName] = fullAddress;
      }
      continue;
    }

    const { firstName, lastName, companyName } = splitName(rawName, csvType);
    const type = mapCustomerType(csvType) || (looksLikeBusiness(rawName, csvType) ? "commercial" : "residential");

    customers.push({
      firstName,
      lastName,
      companyName,
      type,
      phone: phone || "",
      email: email || null,
      source,
      locations: location ? [location] : [],
      sourceNames: [cleanRawName],
      sourceAddresses: fullAddress ? [fullAddress] : [],
      nameToAddress: fullAddress ? { [cleanRawName]: fullAddress } : {},
    });
  }

  return customers;
}

// Shared normalization so other CSV imports (e.g. quotes) can resolve a
// customer by the same raw "Display Name" text used in this file.
function normalizeCustomerName(name) {
  return (name || "")
    .trim()
    .replace(/^"+|"+$/g, "")
    .toLowerCase()
    .replace(/[.,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  parseCustomersCsv,
  parseFullAddress,
  splitName,
  normalizeCustomerName,
};
