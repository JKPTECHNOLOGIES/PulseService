/**
 * The public QuickBooks Web Connector (QBWC) SOAP endpoint. No JWT — QBWC has
 * no concept of a bearer token, only the username/password given to
 * `authenticate`. Session state (the "ticket" QBWC carries for the rest of a
 * session) lives in memory since this runs as a single backend process.
 *
 * QBWC drives eight methods per session, always in this order:
 *   authenticate -> [sendRequestXML -> receiveResponseXML]* -> closeConnection
 * clientVersion/serverVersion are asked once up front; connectionError and
 * getLastError are only invoked when something goes wrong.
 */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../config/database");
const soap = require("../services/quickbooks/soap.util");
const qbxml = require("../services/quickbooks/qbxml.service");
const queue = require("../services/quickbooks/sync-queue.service");

// ticket -> { lastError }
const sessions = new Map();

async function getOrCreateSettings() {
  let settings = await prisma.quickBooksSettings.findFirst();
  if (!settings)
    settings = await prisma.quickBooksSettings.create({ data: {} });
  return settings;
}

async function handleAuthenticate(params) {
  const settings = await getOrCreateSettings();
  const { strUserName, strPassword } = params;

  const userOk = strUserName === settings.webConnectorUsername;
  const passOk =
    userOk &&
    !!settings.webConnectorPasswordHash &&
    (await bcrypt.compare(
      strPassword ?? "",
      settings.webConnectorPasswordHash,
    ));

  if (!settings.isEnabled || !userOk || !passOk) {
    return ["", "nvu"]; // "not a valid user" — QBWC surfaces an auth error and stops
  }

  const ticket = crypto.randomUUID();
  sessions.set(ticket, { lastError: "" });
  await prisma.quickBooksSettings.update({
    where: { id: settings.id },
    data: { lastSyncStartedAt: new Date() },
  });

  const pending = await queue.countPending();
  // Empty string = "use whichever company file QuickBooks currently has open".
  // "none" = valid session, but nothing queued right now.
  return pending > 0 ? [ticket, ""] : [ticket, "none"];
}

function handleClientVersion() {
  return ""; // empty = accepted, no compatibility warning shown to the user
}

function handleServerVersion() {
  return "1.0.0";
}

async function handleSendRequestXML(params) {
  const { ticket, qbXMLMajorVers, qbXMLMinorVers } = params;
  if (!sessions.has(ticket)) return "";

  const job = await queue.getNextPending();
  if (!job) return ""; // empty -> QBWC moves on to closeConnection

  const version =
    qbXMLMajorVers && qbXMLMinorVers
      ? `${qbXMLMajorVers}.${qbXMLMinorVers}`
      : qbxml.DEFAULT_QBXML_VERSION;

  try {
    const requestXml = await queue.buildRequestForJob(job, version);
    await queue.markSent(job.id, job.id); // our own queue row id doubles as requestID
    return requestXml;
  } catch (err) {
    await queue.markError(job.id, err.message);
    const session = sessions.get(ticket);
    if (session) session.lastError = err.message;
    return ""; // skip this round; the job is now flagged "error", not stuck
  }
}

async function handleReceiveResponseXML(params) {
  const { ticket, response, hresult, message } = params;
  const session = sessions.get(ticket);

  if (hresult) {
    // A QBWC/QuickBooks connection-level failure, not a qbXML business error —
    // there's no response body to parse. Attribute it to whatever we most
    // recently sent so it doesn't stay stuck in "sent" forever.
    if (session) session.lastError = message || `QuickBooks error ${hresult}`;
    const stuck = await queue.findCurrentlySent();
    if (stuck)
      await queue.markError(
        stuck.id,
        message || `QuickBooks connection error ${hresult}`,
      );
    return 100;
  }

  try {
    const parsed = qbxml.parseQbxmlResponse(response);
    await queue.applyResponse(parsed);
    if (!qbxml.isSuccess(parsed) && session) {
      session.lastError =
        parsed.statusMessage || `QuickBooks error ${parsed.statusCode}`;
    }
  } catch (err) {
    if (session) session.lastError = err.message;
  }

  const remaining = await queue.countPending();
  return remaining > 0 ? 50 : 100;
}

function handleConnectionError(params) {
  const session = sessions.get(params.ticket);
  if (session) session.lastError = params.message || "Connection error";
  return "done"; // don't ask QBWC to retry against an alternate company file
}

function handleGetLastError(params) {
  const session = sessions.get(params.ticket);
  return session?.lastError || "No error on record.";
}

async function handleCloseConnection(params) {
  sessions.delete(params.ticket);
  const settings = await getOrCreateSettings();
  await prisma.quickBooksSettings.update({
    where: { id: settings.id },
    data: { lastSyncCompletedAt: new Date() },
  });
  return "PulseService sync complete.";
}

const HANDLERS = {
  authenticate: handleAuthenticate,
  clientVersion: handleClientVersion,
  serverVersion: handleServerVersion,
  sendRequestXML: handleSendRequestXML,
  receiveResponseXML: handleReceiveResponseXML,
  connectionError: handleConnectionError,
  getLastError: handleGetLastError,
  closeConnection: handleCloseConnection,
};

const handle = async (req, res) => {
  try {
    const { method, params } = soap.parseSoapRequest(req.body);
    const handler = HANDLERS[method];
    if (!handler) {
      return res
        .status(400)
        .type("text/xml")
        .send(soap.buildSoapFault(`Unknown QBWC method: ${method}`));
    }
    const result = await handler(params);
    return res.type("text/xml").send(soap.buildSoapResponse(method, result));
  } catch (err) {
    console.error("quickbooks soap error:", err);
    return res
      .status(500)
      .type("text/xml")
      .send(soap.buildSoapFault(err.message));
  }
};

module.exports = { handle };
