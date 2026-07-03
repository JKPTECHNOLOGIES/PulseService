/**
 * Mock QuickBooks Web Connector (QBWC) session.
 *
 * Exercises the full QBWC SOAP protocol against a running PulseService
 * backend WITHOUT any real QuickBooks Desktop install: it drives our SOAP
 * endpoint exactly as a real Web Connector would (authenticate ->
 * [sendRequestXML -> receiveResponseXML]* -> closeConnection), and fabricates
 * plausible qbXML responses in place of a real QuickBooks company file
 * (fake ListIDs/EditSequences, plus one deliberately-scripted duplicate-name
 * error to prove the failure path).
 *
 * This is the primary validation tool for the QuickBooks sync module until a
 * real QuickBooks Desktop + Web Connector is available to rehearse against
 * (see docs/quickbooks-sync.md for what that residual step covers).
 *
 * Usage:  node scripts/mock-webconnector.js [baseUrl]
 * Requires the backend + seeded DB to be running (defaults to
 * http://localhost:3000/api/v1).
 */

const BASE = process.argv[2] || "http://localhost:3000/api/v1";
const SOAP_URL = `${BASE}/quickbooks/soap`;
const QBWC_USERNAME = "mockqbwc";
const QBWC_PASSWORD = "mock-harness-password";

let fakeListIdCounter = 80000001;
function nextFakeListId() {
  return `${fakeListIdCounter++}-${Date.now()}`;
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
  if (res.status >= 400) throw new Error(`${method} -> HTTP ${res.status}: ${text}`);
  return extractResult(method, text);
}

// The SOAP responses we generate are simple enough to read back with a
// couple of targeted regexes rather than a full parser.
function extractResult(method, xml) {
  const resultBlock = xml.match(new RegExp(`<${method}Result>([\\s\\S]*?)</${method}Result>`));
  if (!resultBlock) throw new Error(`No <${method}Result> in response:\n${xml}`);
  const inner = resultBlock[1];
  const strings = [...inner.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) =>
    decodeXml(m[1]),
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
  const isAdd = /CustomerAddRq/.test(qbxml);
  const isMod = /CustomerModRq/.test(qbxml);
  const name = qbxml.match(/<Name>([^<]*)<\/Name>/)?.[1];
  return { requestId, rqType: isAdd ? "CustomerAddRq" : isMod ? "CustomerModRq" : "unknown", name };
}

function fakeCustomerSuccessResponse({ rqType, requestId, name, listId, editSequence }) {
  const rsType = rqType === "CustomerAddRq" ? "CustomerAddRs" : "CustomerModRs";
  return (
    `<?xml version="1.0"?>\n<QBXML><QBXMLMsgsRs>` +
    `<${rsType} requestID="${requestId}" statusCode="0" statusSeverity="Info" statusMessage="Status OK">` +
    `<CustomerRet><ListID>${listId}</ListID><EditSequence>${editSequence}</EditSequence><Name>${name}</Name></CustomerRet>` +
    `</${rsType}></QBXMLMsgsRs></QBXML>`
  );
}

function fakeDuplicateNameErrorResponse({ rqType, requestId }) {
  const rsType = rqType === "CustomerAddRq" ? "CustomerAddRs" : "CustomerModRs";
  return (
    `<?xml version="1.0"?>\n<QBXML><QBXMLMsgsRs>` +
    `<${rsType} requestID="${requestId}" statusCode="3100" statusSeverity="Error" ` +
    `statusMessage="The name of the list element is already in use.">` +
    `</${rsType}></QBXMLMsgsRs></QBXML>`
  );
}

async function adminLogin() {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@pulseservice.com", password: "admin123" }),
  }).then((r) => r.json());
  return res.data.token;
}

async function adminApi(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
  });
  return res.json();
}

/**
 * Runs one full QBWC session, fabricating a response for each pending job.
 * `scriptedFailureForName`, if given, makes ONE matching job fail with a
 * duplicate-name error instead of succeeding (to exercise the error path).
 */
async function runSession(label, { scriptedFailureForName } = {}) {
  console.log(`\n--- QBWC session: ${label} ---`);

  const [ticket, companyFileState] = await callSoap(
    "authenticate",
    `<strUserName>${QBWC_USERNAME}</strUserName><strPassword>${QBWC_PASSWORD}</strPassword>`,
  );
  console.log(`authenticate -> ticket=${ticket ? "(assigned)" : "(none)"}, state="${companyFileState}"`);
  if (!ticket) throw new Error("authenticate failed — check QuickBooksSettings credentials");
  if (companyFileState === "none") {
    console.log("Nothing queued. Session ends here (as a real Web Connector would).");
    return;
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

    const { requestId, rqType, name } = inspectRequest(requestXml);
    const shouldFail = scriptedFailureForName && name === scriptedFailureForName;
    console.log(
      `sendRequestXML round ${round} -> ${rqType} "${name}" (requestID=${requestId})` +
        (shouldFail ? "  [scripted FAILURE]" : ""),
    );

    const responseXml = shouldFail
      ? fakeDuplicateNameErrorResponse({ rqType, requestId })
      : fakeCustomerSuccessResponse({
          rqType,
          requestId,
          name,
          listId: nextFakeListId(),
          editSequence: String(Date.now()),
        });

    const pctDone = await callSoap(
      "receiveResponseXML",
      `<ticket>${ticket}</ticket><response>${escapeForSoap(responseXml)}</response>` +
        `<hresult></hresult><message></message>`,
    );
    console.log(`receiveResponseXML round ${round} -> ${pctDone}% done`);
  }

  const closeMsg = await callSoap("closeConnection", `<ticket>${ticket}</ticket>`);
  console.log(`closeConnection -> "${closeMsg}"`);
}

function escapeForSoap(xml) {
  return xml
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function main() {
  const token = await adminLogin();

  console.log("Configuring QuickBooksSettings for the mock session...");
  await adminApi(token, "PUT", "/quickbooks/settings", {
    isEnabled: true,
    webConnectorUsername: QBWC_USERNAME,
    webConnectorPassword: QBWC_PASSWORD,
  });

  // A fresh customer guarantees at least one clean "Add" job.
  const created = await adminApi(token, "POST", "/customers", {
    firstName: "Mock",
    lastName: "Harness Customer",
    phone: "555-0100",
    type: "residential",
  });
  const newCustomerId = created.data.id;
  console.log(`Created test customer ${created.data.customerNumber} (${newCustomerId})`);

  // Also queue every other active customer so we exercise a realistic batch.
  const resync = await adminApi(token, "POST", "/quickbooks/resync/customers");
  console.log(`Queued ${resync.data.queued} customer(s) for sync (including existing ones)`);

  // Round 1: everything succeeds except one deliberately-scripted duplicate name.
  await runSession("initial batch (with one scripted failure)", {
    scriptedFailureForName: "Mock Harness Customer",
  });

  const queueAfterRound1 = await adminApi(token, "GET", "/quickbooks/queue?limit=100");
  const synced = queueAfterRound1.data.filter((j) => j.status === "synced").length;
  const errored = queueAfterRound1.data.filter((j) => j.status === "error").length;
  console.log(`\nAfter round 1: ${synced} synced, ${errored} error(s)`);

  const failedJob = queueAfterRound1.data.find(
    (j) => j.status === "error" && j.entityId === newCustomerId,
  );
  if (!failedJob) throw new Error("Expected the scripted duplicate-name failure to be recorded");
  console.log(`Confirmed failure recorded: "${failedJob.lastError}"`);

  console.log("\nRetrying the failed job...");
  await adminApi(token, "POST", `/quickbooks/queue/${failedJob.id}/retry`);

  // Round 2: retry succeeds this time (no scripted failure).
  await runSession("retry of the failed job");

  const mappings = await adminApi(token, "GET", "/quickbooks/mappings");
  const ourMapping = mappings.data.find((m) => m.entityId === newCustomerId);
  if (!ourMapping) throw new Error("Expected a QuickBooksMapping row after the retry succeeded");
  console.log(`Mapping created: quickbooksId=${ourMapping.quickbooksId}`);

  // Round 3: update the customer -> should generate a CustomerModRq using the
  // stored ListID/EditSequence, not another Add.
  await adminApi(token, "PUT", `/customers/${newCustomerId}`, { phone: "555-0199" });
  await runSession("update after editing the customer");

  const mappingsAfterUpdate = await adminApi(token, "GET", "/quickbooks/mappings");
  const updatedMapping = mappingsAfterUpdate.data.find((m) => m.entityId === newCustomerId);
  console.log(
    `EditSequence advanced: ${ourMapping.editSequence} -> ${updatedMapping.editSequence}`,
  );

  console.log("\nMock Web Connector harness PASSED end to end.");
}

main().catch((err) => {
  console.error("\nMock harness FAILED:", err.message);
  process.exitCode = 1;
});
