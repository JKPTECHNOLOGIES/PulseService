/**
 * Minimal SOAP 1.1 envelope helpers for the QuickBooks Web Connector (QBWC)
 * protocol. QBWC calls one of eight methods per HTTP POST (authenticate,
 * sendRequestXML, receiveResponseXML, ...); every param and result is a plain
 * string/int/string-array, never deeply nested, which keeps this generic.
 */
const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true, // so `soap:Body` / `soap:Envelope` come back as `Body` / `Envelope`
  trimValues: true,
  parseTagValue: false, // keep everything as strings; we cast where needed
});

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Parses an incoming QBWC SOAP request. Returns `{ method, params }` where
 * `params` is a flat object of the method's named parameters (as strings).
 */
function parseSoapRequest(rawXml) {
  const doc = parser.parse(rawXml);
  const body = doc?.Envelope?.Body;
  if (!body) throw new Error("Malformed SOAP envelope: no Body element");

  const method = Object.keys(body).find((k) => !k.startsWith("@_"));
  if (!method) throw new Error("Malformed SOAP envelope: no method element");

  const raw = body[method];
  const params = {};
  if (raw && typeof raw === "object") {
    for (const [key, value] of Object.entries(raw)) {
      if (key.startsWith("@_")) continue;
      params[key] = value === undefined || value === null ? "" : String(value);
    }
  }
  return { method, params };
}

/**
 * Builds a QBWC SOAP response. `result` is either a single string/number
 * (most methods) or an array of strings (only `authenticate` returns one).
 */
function buildSoapResponse(methodName, result) {
  let inner;
  if (Array.isArray(result)) {
    inner = result.map((v) => `<string>${escapeXml(v)}</string>`).join("");
  } else if (typeof result === "number") {
    inner = String(result);
  } else {
    inner = escapeXml(result);
  }

  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n` +
    `  <soap:Body>\n` +
    `    <${methodName}Response xmlns="http://developer.intuit.com/">\n` +
    `      <${methodName}Result>${inner}</${methodName}Result>\n` +
    `    </${methodName}Response>\n` +
    `  </soap:Body>\n` +
    `</soap:Envelope>`
  );
}

/** A SOAP 1.1 Fault envelope, for genuinely unexpected server errors only. */
function buildSoapFault(message) {
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n` +
    `  <soap:Body>\n` +
    `    <soap:Fault>\n` +
    `      <faultcode>soap:Server</faultcode>\n` +
    `      <faultstring>${escapeXml(message)}</faultstring>\n` +
    `    </soap:Fault>\n` +
    `  </soap:Body>\n` +
    `</soap:Envelope>`
  );
}

module.exports = { escapeXml, parseSoapRequest, buildSoapResponse, buildSoapFault };
