/**
 * Mock QuickBooks Web Connector (QBWC) session.
 *
 * Exercises the full QBWC SOAP protocol against a running PulseService
 * backend WITHOUT any real QuickBooks Desktop install: it drives our SOAP
 * endpoint exactly as a real Web Connector would (authenticate ->
 * [sendRequestXML -> receiveResponseXML]* -> closeConnection), and fabricates
 * plausible qbXML responses in place of a real QuickBooks company file
 * (fake ListIDs/TxnIDs/EditSequences, plus scripted failures to prove the
 * error path).
 *
 * This is the primary validation tool for the QuickBooks sync module until a
 * real QuickBooks Desktop + Web Connector is available to rehearse against
 * (see docs/quickbooks-sync.md for what that residual step covers).
 *
 * Covers: customer add/update (+ a scripted duplicate-name failure + retry),
 * invoice add (with tax + discount lines), payment add, invoice void, and
 * dependency gating (an invoice for a not-yet-synced customer is correctly
 * ordered AFTER that customer's own sync within the same session).
 *
 * Usage:  node scripts/mock-webconnector.js [baseUrl]
 * Requires the backend + seeded DB to be running (defaults to
 * http://localhost:3000/api/v1).
 */

const BASE = process.argv[2] || "http://localhost:3000/api/v1";
const SOAP_URL = `${BASE}/quickbooks/soap`;
const QBWC_USERNAME = "mockqbwc";
const QBWC_PASSWORD = "mock-harness-password";

let fakeIdCounter = 80000001;
function nextFakeId() {
  return `${fakeIdCounter++}-${Date.now()}`;
}

function soapRequest(method, paramsXml) {
  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ` +
    `xmlns:xsd="http://www.w3.org/2001/XMLSchema" ` +
    `xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">\n` +
    `  <soap:Body>\n` +
    `    <${method} xmlns="http://developer.intuit.com/">${paramsXml}</${method}>\n` +
    `  </soap:Body>\n` +
    `</soap:Envelope>`
  );
}

async function callSoap(method, paramsXml) {
  const res = await fetch(SOAP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8" },
    body: soapRequest(method, paramsXml),
  });
  const text = await res.text();
  if (res.status >= 400)
    throw new Error(`${method} -> HTTP ${res.status}: ${text}`);
  return extractResult(method, text);
}

function extractResult(method, xml) {
  const resultBlock = xml.match(
    new RegExp(`<${method}Result>([\\s\\S]*?)</${method}Result>`),
  );
  if (!resultBlock)
    throw new Error(`No <${method}Result> in response:\n${xml}`);
  const inner = resultBlock[1];
  const strings = [...inner.matchAll(/<string>([\s\S]*?)<\/string>/g)].map(
    (m) => decodeXml(m[1]),
  );
  if (strings.length > 0) return strings;
  return decodeXml(inner.trim());
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Reads just enough out of the qbXML request QBWC would have gotten to
// fabricate a matching response, the way a real QuickBooks company file would.
function inspectRequest(qbxml) {
  const requestId = qbxml.match(/requestID="([^"]+)"/)?.[1];
  const rqType = qbxml.match(/<(\w+Rq) requestID=/)?.[1] || "unknown";
  const name = qbxml.match(/<Name>([^<]*)<\/Name>/)?.[1];
  const refNumber = qbxml.match(/<RefNumber>([^<]*)<\/RefNumber>/)?.[1];
  const lineCount = (qbxml.match(/<InvoiceLineAdd>/g) || []).length;
  return { requestId, rqType, name, refNumber, lineCount };
}

/** Fabricates a success response matching whatever request type was sent. */
function fakeSuccessResponse({ rqType, requestId, name }) {
  const rsType = rqType.replace(/Rq$/, "Rs");
  const listOrTxnId = nextFakeId();
  const editSequence = String(Date.now());

  if (rqType === "TxnVoidRq") {
    return (
      `<?xml version="1.0"?><QBXML><QBXMLMsgsRs>` +
      `<${rsType} requestID="${requestId}" statusCode="0" statusSeverity="Info" statusMessage="Status OK"></${rsType}>` +
      `</QBXMLMsgsRs></QBXML>`
    );
  }
  if (rqType === "CustomerAddRq" || rqType === "CustomerModRq") {
    return (
      `<?xml version="1.0"?><QBXML><QBXMLMsgsRs>` +
      `<${rsType} requestID="${requestId}" statusCode="0" statusSeverity="Info" statusMessage="Status OK">` +
      `<CustomerRet><ListID>${listOrTxnId}</ListID><EditSequence>${editSequence}</EditSequence><Name>${name}</Name></CustomerRet>` +
      `</${rsType}></QBXMLMsgsRs></QBXML>`
    );
  }
  if (rqType === "InvoiceAddRq" || rqType === "InvoiceModRq") {
    return (
      `<?xml version="1.0"?><QBXML><QBXMLMsgsRs>` +
      `<${rsType} requestID="${requestId}" statusCode="0" statusSeverity="Info" statusMessage="Status OK">` +
      `<InvoiceRet><TxnID>${listOrTxnId}</TxnID><EditSequence>${editSequence}</EditSequence></InvoiceRet>` +
      `</${rsType}></QBXMLMsgsRs></QBXML>`
    );
  }
  if (rqType === "ReceivePaymentAddRq") {
    return (
      `<?xml version="1.0"?><QBXML><QBXMLMsgsRs>` +
      `<${rsType} requestID="${requestId}" statusCode="0" statusSeverity="Info" statusMessage="Status OK">` +
      `<ReceivePaymentRet><TxnID>${listOrTxnId}</TxnID><EditSequence>${editSequence}</EditSequence></ReceivePaymentRet>` +
      `</${rsType}></QBXMLMsgsRs></QBXML>`
    );
  }
  throw new Error(
    `Mock harness doesn't know how to fabricate a response for ${rqType}`,
  );
}

function fakeDuplicateNameErrorResponse({ rqType, requestId }) {
  const rsType = rqType.replace(/Rq$/, "Rs");
  return (
    `<?xml version="1.0"?><QBXML><QBXMLMsgsRs>` +
    `<${rsType} requestID="${requestId}" statusCode="3100" statusSeverity="Error" ` +
    `statusMessage="The name of the list element is already in use.">` +
    `</${rsType}></QBXMLMsgsRs></QBXML>`
  );
}

async function adminLogin() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@pulseservice.com",
      password: "admin123",
    }),
  }).then((r) => r.json());
  return res.data.token;
}

async function adminApi(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    ...(body && { body: JSON.stringify(body) }),
  });
  const json = await res.json();
  if (res.status >= 400) {
    throw new Error(
      `${method} ${path} -> HTTP ${res.status}: ${JSON.stringify(json)}`,
    );
  }
  return json;
}

/**
 * Runs one full QBWC session, fabricating a response for each pending job.
 * `scriptedFailureForName`, if given, makes ONE matching job fail with a
 * duplicate-name error instead of succeeding (to exercise the error path).
 * Returns the ordered list of `{ rqType, label }` requests that were sent, so
 * callers can assert on ordering (e.g. a dependency synced before whatever
 * depended on it).
 */
async function runSession(label, { scriptedFailureForName } = {}) {
  console.log(`\n--- QBWC session: ${label} ---`);
  const sent = [];

  const [ticket, companyFileState] = await callSoap(
    "authenticate",
    `<strUserName>${QBWC_USERNAME}</strUserName><strPassword>${QBWC_PASSWORD}</strPassword>`,
  );
  console.log(
    `authenticate -> ticket=${ticket ? "(assigned)" : "(none)"}, state="${companyFileState}"`,
  );
  if (!ticket)
    throw new Error(
      "authenticate failed — check QuickBooksSettings credentials",
    );
  if (companyFileState === "none") {
    console.log(
      "Nothing queued/ready. Session ends here (as a real Web Connector would).",
    );
    return sent;
  }

  await callSoap("clientVersion", `<strVersion>2.1.0.30</strVersion>`);

  let round = 0;
  for (;;) {
    round += 1;
    const requestXml = await callSoap(
      "sendRequestXML",
      `<ticket>${ticket}</ticket><strHCPResponse></strHCPResponse>` +
        `<strCompanyFileName></strCompanyFileName><qbXMLCountry>US</qbXMLCountry>` +
        `<qbXMLMajorVers>13</qbXMLMajorVers><qbXMLMinorVers>0</qbXMLMinorVers>`,
    );
    if (!requestXml) {
      console.log(`sendRequestXML round ${round} -> (empty) queue drained`);
      break;
    }

    const { requestId, rqType, name, refNumber, lineCount } =
      inspectRequest(requestXml);
    const entryLabel = name || refNumber || "(no label)";
    const shouldFail =
      scriptedFailureForName && name === scriptedFailureForName;
    console.log(
      `sendRequestXML round ${round} -> ${rqType} "${entryLabel}"` +
        (lineCount ? ` (${lineCount} line(s))` : "") +
        (shouldFail ? "  [scripted FAILURE]" : ""),
    );
    sent.push({ rqType, label: entryLabel });

    const responseXml = shouldFail
      ? fakeDuplicateNameErrorResponse({ rqType, requestId })
      : fakeSuccessResponse({ rqType, requestId, name });

    const pctDone = await callSoap(
      "receiveResponseXML",
      `<ticket>${ticket}</ticket><response>${escapeForSoap(responseXml)}</response>` +
        `<hresult></hresult><message></message>`,
    );
    console.log(`receiveResponseXML round ${round} -> ${pctDone}% done`);
  }

  const closeMsg = await callSoap(
    "closeConnection",
    `<ticket>${ticket}</ticket>`,
  );
  console.log(`closeConnection -> "${closeMsg}"`);
  return sent;
}

function escapeForSoap(xml) {
  return xml.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function customerPhase(token) {
  console.log("\n=========== PHASE 1: customer sync ===========");

  const created = await adminApi(token, "POST", "/customers", {
    firstName: "Mock",
    lastName: "Harness Customer",
    phone: "555-0100",
    type: "residential",
  });
  const customerId = created.data.id;
  console.log(
    `Created test customer ${created.data.customerNumber} (${customerId})`,
  );

  const resync = await adminApi(token, "POST", "/quickbooks/resync/customers");
  console.log(
    `Queued ${resync.data.queued} customer(s) for sync (including existing ones)`,
  );

  await runSession("initial batch (with one scripted failure)", {
    scriptedFailureForName: "Mock Harness Customer",
  });

  const queueAfterRound1 = await adminApi(
    token,
    "GET",
    "/quickbooks/queue?limit=100",
  );
  const errored = queueAfterRound1.data.filter((j) => j.status === "error");
  const failedJob = errored.find((j) => j.entityId === customerId);
  if (!failedJob)
    throw new Error(
      "Expected the scripted duplicate-name failure to be recorded",
    );
  console.log(`Confirmed failure recorded: "${failedJob.lastError}"`);

  console.log("Retrying the failed job...");
  await adminApi(token, "POST", `/quickbooks/queue/${failedJob.id}/retry`);
  await runSession("retry of the failed job");

  const mappings = await adminApi(token, "GET", "/quickbooks/mappings");
  const ourMapping = mappings.data.find((m) => m.entityId === customerId);
  if (!ourMapping)
    throw new Error(
      "Expected a QuickBooksMapping row after the retry succeeded",
    );
  console.log(
    `Customer mapping created: quickbooksId=${ourMapping.quickbooksId}`,
  );

  await adminApi(token, "PUT", `/customers/${customerId}`, {
    phone: "555-0199",
  });
  await runSession("update after editing the customer");

  const mappingsAfterUpdate = await adminApi(
    token,
    "GET",
    "/quickbooks/mappings",
  );
  const updatedMapping = mappingsAfterUpdate.data.find(
    (m) => m.entityId === customerId,
  );
  console.log(
    `EditSequence advanced: ${ourMapping.editSequence} -> ${updatedMapping.editSequence}`,
  );

  return customerId;
}

async function invoicePaymentPhase(token, customerId) {
  console.log("\n=========== PHASE 2: invoice + payment sync ===========");

  const item = await adminApi(token, "POST", "/pricebook/items", {
    name: "Mock Harness Labor",
    type: "labor",
    unitCost: 30,
    unitPrice: 100,
    taxable: true,
  });
  await adminApi(token, "POST", "/quickbooks/item-mappings", {
    pricebookItemId: item.data.id,
    quickbooksItemName: "Mock QB Labor Item",
  });
  await adminApi(token, "POST", "/quickbooks/item-mappings", {
    lineItemType: "discount",
    quickbooksItemName: "Mock QB Discount Item",
  });
  console.log(
    "Pricebook item + item mappings created (specific item + discount category)",
  );

  // Created directly as "sent" (skipping the draft->send UI step) so the sync
  // trigger fires immediately for this test. Customer is already synced from
  // phase 1, so this invoice should be immediately sendable.
  const invoice = await adminApi(token, "POST", "/invoices", {
    customerId,
    status: "sent",
    discountType: "fixed",
    discountValue: 10,
    lineItems: [
      {
        type: "labor",
        name: "Mock Harness Labor",
        pricebookItemId: item.data.id,
        quantity: 2,
        unitPrice: 100,
      },
    ],
  });
  const invoiceId = invoice.data.id;
  console.log(
    `Created invoice ${invoice.data.invoiceNumber} (total=${invoice.data.total}, tax=${invoice.data.taxAmount})`,
  );

  const sent = await runSession(
    "invoice add (discount line, customer already synced)",
  );
  const invoiceSend = sent.find((s) => s.rqType === "InvoiceAddRq");
  if (!invoiceSend)
    throw new Error("Expected an InvoiceAddRq to have been sent");
  // 1 real line + 1 discount line = 2 (tax is no longer charged)
  console.log(`InvoiceAddRq confirmed sent: "${invoiceSend.label}"`);

  const mappingsAfterInvoice = await adminApi(
    token,
    "GET",
    "/quickbooks/mappings",
  );
  const invoiceMapping = mappingsAfterInvoice.data.find(
    (m) => m.entityType === "invoice" && m.entityId === invoiceId,
  );
  if (!invoiceMapping) throw new Error("Expected the invoice to have synced");
  console.log(
    `Invoice mapping created: quickbooksId=${invoiceMapping.quickbooksId}`,
  );

  const payment = await adminApi(
    token,
    "POST",
    `/invoices/${invoiceId}/payments`,
    {
      amount: invoice.data.total,
      method: "ach",
      referenceNumber: "ACH-MOCK-1",
    },
  );
  console.log(
    `Recorded payment ${payment.data.payment.id} for ${payment.data.payment.amount}`,
  );

  await runSession("payment add (invoice already synced)");

  const mappingsAfterPayment = await adminApi(
    token,
    "GET",
    "/quickbooks/mappings",
  );
  const paymentMapping = mappingsAfterPayment.data.find(
    (m) => m.entityType === "payment" && m.entityId === payment.data.payment.id,
  );
  if (!paymentMapping) throw new Error("Expected the payment to have synced");
  console.log(
    `Payment mapping created: quickbooksId=${paymentMapping.quickbooksId}`,
  );

  console.log("Voiding the invoice (just to exercise the void path)...");
  await adminApi(token, "POST", `/invoices/${invoiceId}/void`, {
    voidReason: "Mock harness test",
  });
  await runSession("invoice void");

  const queueAfterVoid = await adminApi(
    token,
    "GET",
    "/quickbooks/queue?limit=100",
  );
  const voidJob = queueAfterVoid.data.find(
    (j) =>
      j.entityType === "invoice" &&
      j.entityId === invoiceId &&
      j.operation === "void",
  );
  if (!voidJob || voidJob.status !== "synced")
    throw new Error("Expected the void to have synced");
  if (!voidJob || voidJob.status !== "synced")
    throw new Error("Expected the void to have synced");
  console.log("Void confirmed synced.");

  return { pricebookItemId: item.data.id, pricebookItemName: item.data.name };
}

async function dependencyGatingPhase(token, mappedItem) {
  console.log("\n=========== PHASE 3: dependency gating ===========");

  // A brand-new, not-yet-synced customer + an invoice for them created in the
  // same breath. Both jobs land in the queue at once; the invoice must not be
  // sent before its customer, even though a single continuous session will
  // resolve both (dependencies clear progressively as each job completes).
  const customer = await adminApi(token, "POST", "/customers", {
    firstName: "Not",
    lastName: "YetSynced",
    phone: "555-0200",
    type: "residential",
  });

  // Reuse the item mapped in phase 2 so building the request can't fail for
  // an unrelated reason (unmapped item) and mask the ordering assertion.
  const invoice = await adminApi(token, "POST", "/invoices", {
    customerId: customer.data.id,
    status: "sent",
    lineItems: [
      {
        type: "labor",
        name: mappedItem.pricebookItemName,
        pricebookItemId: mappedItem.pricebookItemId,
        quantity: 1,
        unitPrice: 50,
      },
    ],
  });
  console.log(
    `Created customer "${customer.data.firstName} ${customer.data.lastName}" and invoice ` +
      `${invoice.data.invoiceNumber} together (customer not yet synced)`,
  );

  const sent = await runSession(
    "dependency gating: unsynced customer + its invoice",
  );
  const customerIdx = sent.findIndex(
    (s) => s.rqType === "CustomerAddRq" && s.label === "Not YetSynced",
  );
  const invoiceIdx = sent.findIndex(
    (s) =>
      s.rqType === "InvoiceAddRq" && s.label === invoice.data.invoiceNumber,
  );
  if (customerIdx === -1)
    throw new Error("Expected the new customer to have been sent");
  if (invoiceIdx === -1)
    throw new Error("Expected the invoice to eventually have been sent");
  if (!(customerIdx < invoiceIdx)) {
    throw new Error(
      `Expected the customer (index ${customerIdx}) to sync before its invoice (index ${invoiceIdx})`,
    );
  }
  console.log(
    `Confirmed correct ordering: customer sent at position ${customerIdx}, its invoice at ${invoiceIdx}.`,
  );
}

async function main() {
  const token = await adminLogin();

  console.log("Configuring QuickBooksSettings for the mock session...");
  await adminApi(token, "PUT", "/quickbooks/settings", {
    isEnabled: true,
    webConnectorUsername: QBWC_USERNAME,
    webConnectorPassword: QBWC_PASSWORD,
  });

  const customerId = await customerPhase(token);
  const mappedItem = await invoicePaymentPhase(token, customerId);
  await dependencyGatingPhase(token, mappedItem);

  console.log("\nMock Web Connector harness PASSED end to end.");
}

main().catch((err) => {
  console.error("\nMock harness FAILED:", err.message);
  process.exitCode = 1;
});
