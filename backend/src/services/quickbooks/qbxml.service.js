/**
 * Builds outbound qbXML request documents and parses qbXML response documents.
 * Only Customer Add/Mod are implemented so far (Phase 1: sync foundation +
 * customer sync). Invoice/Payment builders slot in the same way later —
 * nothing about the SOAP/session state machine needs to change for them.
 *
 * Reference: Intuit qbXML OSR (onscreenref.com) for the exact request/response
 * shapes. We keep to a conservative, widely-supported field set.
 */
const { XMLParser } = require("fast-xml-parser");
const { escapeXml } = require("./soap.util");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false, // EditSequence/ListID etc. are opaque strings, not numbers
  parseAttributeValue: false, // statusCode must stay a comparable string ("0")
});

// A qbXML version every QuickBooks Desktop release from the last decade-plus
// understands. QBWC reports what the connected Desktop supports on every
// sendRequestXML call; callers may override with that value when known.
const DEFAULT_QBXML_VERSION = "13.0";

function tag(name, value) {
  if (value === undefined || value === null || value === "") return "";
  return `<${name}>${escapeXml(value)}</${name}>`;
}

function wrap(version, bodyXml) {
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<?qbxml version="${version}"?>\n` +
    `<QBXML>\n` +
    `  <QBXMLMsgsRq onError="continueOnError">\n` +
    `${bodyXml}` +
    `  </QBXMLMsgsRq>\n` +
    `</QBXML>`
  );
}

// QuickBooks' "Name" (list) field is limited to 41 characters and must be
// unique across every name list (customers, vendors, employees...).
function resolveCustomerName(customer) {
  const raw =
    customer.companyName?.trim() ||
    `${customer.firstName} ${customer.lastName}`.trim();
  return raw.slice(0, 41);
}

/**
 * @param {object} input
 * @param {string} input.requestId
 * @param {object} input.customer - { companyName?, firstName, lastName, phone?, email?, billAddress? }
 * @param {string} [input.qbxmlVersion]
 */
function buildCustomerAddRequest({
  requestId,
  customer,
  qbxmlVersion = DEFAULT_QBXML_VERSION,
}) {
  const addr = customer.billAddress;
  const addressXml = addr
    ? `        <BillAddress>\n` +
      `          ${tag("Addr1", addr.address)}\n` +
      `          ${tag("City", addr.city)}\n` +
      `          ${tag("State", addr.state)}\n` +
      `          ${tag("PostalCode", addr.zip)}\n` +
      `        </BillAddress>\n`
    : "";

  const body =
    `    <CustomerAddRq requestID="${escapeXml(requestId)}">\n` +
    `      <CustomerAdd>\n` +
    `        ${tag("Name", resolveCustomerName(customer))}\n` +
    `        ${tag("CompanyName", customer.companyName)}\n` +
    `        ${tag("FirstName", customer.firstName)}\n` +
    `        ${tag("LastName", customer.lastName)}\n` +
    `        ${tag("Phone", customer.phone)}\n` +
    `        ${tag("Email", customer.email)}\n` +
    addressXml +
    `      </CustomerAdd>\n` +
    `    </CustomerAddRq>\n`;

  return wrap(qbxmlVersion, body);
}

/**
 * @param {object} input
 * @param {string} input.requestId
 * @param {object} input.customer
 * @param {string} input.quickbooksId - the ListID assigned on the original Add
 * @param {string} input.editSequence - QuickBooks' optimistic-concurrency token
 */
function buildCustomerModRequest({
  requestId,
  customer,
  quickbooksId,
  editSequence,
  qbxmlVersion = DEFAULT_QBXML_VERSION,
}) {
  const addr = customer.billAddress;
  const addressXml = addr
    ? `        <BillAddress>\n` +
      `          ${tag("Addr1", addr.address)}\n` +
      `          ${tag("City", addr.city)}\n` +
      `          ${tag("State", addr.state)}\n` +
      `          ${tag("PostalCode", addr.zip)}\n` +
      `        </BillAddress>\n`
    : "";

  const body =
    `    <CustomerModRq requestID="${escapeXml(requestId)}">\n` +
    `      <CustomerMod>\n` +
    `        ${tag("ListID", quickbooksId)}\n` +
    `        ${tag("EditSequence", editSequence)}\n` +
    `        ${tag("Name", resolveCustomerName(customer))}\n` +
    `        ${tag("CompanyName", customer.companyName)}\n` +
    `        ${tag("FirstName", customer.firstName)}\n` +
    `        ${tag("LastName", customer.lastName)}\n` +
    `        ${tag("Phone", customer.phone)}\n` +
    `        ${tag("Email", customer.email)}\n` +
    addressXml +
    `      </CustomerMod>\n` +
    `    </CustomerModRq>\n`;

  return wrap(qbxmlVersion, body);
}

/**
 * Parses a single qbXML response message (we always send exactly one request
 * per sendRequestXML/receiveResponseXML round trip, so there's exactly one
 * `*Rs` element to read). Returns `{ rsType, requestId, statusCode,
 * statusSeverity, statusMessage, ret }` — `ret` is the `*Ret` object (ListID/
 * TxnID/EditSequence/...) on success, or `null` on error.
 */
function parseQbxmlResponse(xmlString) {
  const doc = parser.parse(xmlString);
  const msgs = doc?.QBXML?.QBXMLMsgsRs;
  if (!msgs) throw new Error("Malformed qbXML response: missing QBXMLMsgsRs");

  const rsType = Object.keys(msgs).find(
    (k) => !k.startsWith("@_") && k.endsWith("Rs"),
  );
  if (!rsType)
    throw new Error("Malformed qbXML response: no *Rs element found");

  const rs = msgs[rsType];
  const retType = Object.keys(rs).find(
    (k) => !k.startsWith("@_") && k.endsWith("Ret"),
  );
  const ret = retType ? rs[retType] : null;

  return {
    rsType,
    requestId: rs["@_requestID"] ?? null,
    statusCode: rs["@_statusCode"] ?? null,
    statusSeverity: rs["@_statusSeverity"] ?? null,
    statusMessage: rs["@_statusMessage"] ?? null,
    ret,
  };
}

/** True when a parsed response represents success (statusCode "0"). */
function isSuccess(parsed) {
  return parsed.statusCode === "0";
}

/** Pulls the identity fields QuickBooks assigns back out of a `*Ret` object. */
function extractIdentity(ret) {
  if (!ret) return null;
  return {
    listId: ret.ListID ?? null,
    txnId: ret.TxnID ?? null,
    editSequence: ret.EditSequence ?? null,
  };
}

function toQbDate(date) {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * @param {object} input
 * @param {string} input.requestId
 * @param {object} input.invoice - PulseService Invoice row (invoiceNumber, dueDate, createdAt, notes)
 * @param {string} input.customerQbId - the customer's QuickBooks ListID (must already be synced)
 * @param {Array<{itemName: string, description?: string, quantity?: number, rate?: number, amount: number}>} input.lines
 */
function buildInvoiceAddRequest({
  requestId,
  invoice,
  customerQbId,
  lines,
  qbxmlVersion = DEFAULT_QBXML_VERSION,
}) {
  const linesXml = lines
    .map(
      (l) =>
        `      <InvoiceLineAdd>\n` +
        `        <ItemRef><FullName>${escapeXml(l.itemName)}</FullName></ItemRef>\n` +
        `        ${tag("Desc", l.description)}\n` +
        `        ${l.quantity !== undefined ? tag("Quantity", l.quantity) : ""}\n` +
        `        ${l.rate !== undefined ? tag("Rate", l.rate.toFixed(2)) : ""}\n` +
        `        ${tag("Amount", Number(l.amount).toFixed(2))}\n` +
        `      </InvoiceLineAdd>\n`,
    )
    .join("");

  const body =
    `    <InvoiceAddRq requestID="${escapeXml(requestId)}">\n` +
    `      <InvoiceAdd>\n` +
    `        <CustomerRef><ListID>${escapeXml(customerQbId)}</ListID></CustomerRef>\n` +
    `        ${tag("TxnDate", toQbDate(invoice.createdAt))}\n` +
    `        ${tag("RefNumber", invoice.invoiceNumber)}\n` +
    `        ${tag("DueDate", toQbDate(invoice.dueDate))}\n` +
    `        ${tag("Memo", invoice.notes)}\n` +
    linesXml +
    `      </InvoiceAdd>\n` +
    `    </InvoiceAddRq>\n`;

  return wrap(qbxmlVersion, body);
}

/**
 * Header-only update (RefNumber/TxnDate/DueDate/Memo) — deliberately does NOT
 * touch line items. Replacing an already-synced invoice's lines in qbXML
 * requires per-line TxnLineID tracking; since invoices are treated as
 * effectively immutable once sent (balance/paid status flows through
 * ReceivePayment, not invoice edits), this covers the realistic update case
 * without that added complexity. See docs/quickbooks-sync.md.
 */
function buildInvoiceModRequest({
  requestId,
  invoice,
  quickbooksId,
  editSequence,
  qbxmlVersion = DEFAULT_QBXML_VERSION,
}) {
  const body =
    `    <InvoiceModRq requestID="${escapeXml(requestId)}">\n` +
    `      <InvoiceMod>\n` +
    `        ${tag("TxnID", quickbooksId)}\n` +
    `        ${tag("EditSequence", editSequence)}\n` +
    `        ${tag("RefNumber", invoice.invoiceNumber)}\n` +
    `        ${tag("TxnDate", toQbDate(invoice.createdAt))}\n` +
    `        ${tag("DueDate", toQbDate(invoice.dueDate))}\n` +
    `        ${tag("Memo", invoice.notes)}\n` +
    `      </InvoiceMod>\n` +
    `    </InvoiceModRq>\n`;

  return wrap(qbxmlVersion, body);
}

/**
 * Voids a transaction (Invoice, SalesReceipt, ...) via the generic TxnVoid
 * request — simpler and better documented than manually zeroing out a
 * transaction's lines.
 */
function buildTxnVoidRequest({
  requestId,
  quickbooksId,
  txnDelType = "Invoice",
  qbxmlVersion = DEFAULT_QBXML_VERSION,
}) {
  const body =
    `    <TxnVoidRq requestID="${escapeXml(requestId)}">\n` +
    `      <TxnVoidMod>\n` +
    `        ${tag("TxnID", quickbooksId)}\n` +
    `        ${tag("TxnDelType", txnDelType)}\n` +
    `      </TxnVoidMod>\n` +
    `    </TxnVoidRq>\n`;

  return wrap(qbxmlVersion, body);
}

/**
 * Reports a completed payment against an already-synced invoice. PulseService
 * never routes money through QuickBooks — this only records that the invoice
 * was paid, so QuickBooks' AR matches reality.
 */
function buildReceivePaymentAddRequest({
  requestId,
  customerQbId,
  payment,
  invoiceTxnId,
  depositToAccountName,
  qbxmlVersion = DEFAULT_QBXML_VERSION,
}) {
  const depositXml = depositToAccountName
    ? `        <DepositToAccountRef><FullName>${escapeXml(depositToAccountName)}</FullName></DepositToAccountRef>\n`
    : "";

  const body =
    `    <ReceivePaymentAddRq requestID="${escapeXml(requestId)}">\n` +
    `      <ReceivePaymentAdd>\n` +
    `        <CustomerRef><ListID>${escapeXml(customerQbId)}</ListID></CustomerRef>\n` +
    `        ${tag("TxnDate", toQbDate(payment.paidAt || payment.createdAt))}\n` +
    `        ${tag("RefNumber", payment.referenceNumber)}\n` +
    `        ${tag("TotalAmount", Number(payment.amount).toFixed(2))}\n` +
    `        ${tag("Memo", payment.notes)}\n` +
    depositXml +
    `        <AppliedToTxnAdd>\n` +
    `          <TxnID>${escapeXml(invoiceTxnId)}</TxnID>\n` +
    `          <PaymentAmount>${Number(payment.amount).toFixed(2)}</PaymentAmount>\n` +
    `        </AppliedToTxnAdd>\n` +
    `      </ReceivePaymentAdd>\n` +
    `    </ReceivePaymentAddRq>\n`;

  return wrap(qbxmlVersion, body);
}

module.exports = {
  DEFAULT_QBXML_VERSION,
  buildCustomerAddRequest,
  buildCustomerModRequest,
  buildInvoiceAddRequest,
  buildInvoiceModRequest,
  buildTxnVoidRequest,
  buildReceivePaymentAddRequest,
  parseQbxmlResponse,
  isSuccess,
  extractIdentity,
  resolveCustomerName,
};
