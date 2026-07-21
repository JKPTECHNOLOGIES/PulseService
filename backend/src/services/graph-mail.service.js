// Sends mail through Microsoft Graph using an app-only (client credentials)
// OAuth2 token — the modern replacement for SMTP basic-auth/XOAUTH2, since
// Microsoft has been disabling basic auth tenant by tenant.
//
// Required env vars:
//   MS_TENANT_ID     - Azure AD directory (tenant) ID
//   MS_CLIENT_ID     - App registration's Application (client) ID
//   MS_CLIENT_SECRET - App registration's client secret
//   MS_MAIL_FROM     - Mailbox (UPN) to send as, e.g. service@primecomfortsolutions.com
//
// The app registration needs the Microsoft Graph *Application* permission
// `Mail.Send` with admin consent granted (not the Delegated variant — there's
// no signed-in user in this flow).

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

function isConfigured() {
  return Boolean(
    process.env.MS_TENANT_ID &&
      process.env.MS_CLIENT_ID &&
      process.env.MS_CLIENT_SECRET &&
      process.env.MS_MAIL_FROM,
  );
}

// Cached app-only token, refreshed a little before it actually expires.
let cachedToken = null; // { accessToken, expiresAt }

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.accessToken;
  }

  const tokenUrl = `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    client_secret: process.env.MS_CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `[graph-mail] Failed to acquire token (${res.status}): ${errText}`,
    );
  }

  const json = await res.json();
  cachedToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return cachedToken.accessToken;
}

function toRecipients(to) {
  const list = Array.isArray(to) ? to : String(to).split(",");
  return list
    .map((addr) => addr.trim())
    .filter(Boolean)
    .map((address) => ({ emailAddress: { address } }));
}

function toGraphAttachments(attachments = []) {
  return attachments.map((att) => {
    const content = Buffer.isBuffer(att.content)
      ? att.content
      : Buffer.from(att.content);
    return {
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: att.filename,
      contentType: att.contentType || "application/octet-stream",
      contentBytes: content.toString("base64"),
    };
  });
}

/**
 * Sends an email via Graph's `/users/{mailbox}/sendMail`. Returns
 * `{ messageId, previewUrl }` to match the nodemailer-based service's shape.
 *
 * Note: Graph's `sendMail` action is fire-and-forget (202 Accepted, no body),
 * so there's no real `messageId` to hand back — it's always `null` here.
 */
async function sendMail({ to, subject, text, html, attachments }) {
  const token = await getAccessToken();

  const message = {
    subject,
    body: {
      contentType: html ? "HTML" : "Text",
      content: html || text || "",
    },
    toRecipients: toRecipients(to),
    attachments: toGraphAttachments(attachments),
  };

  const res = await fetch(
    `${GRAPH_BASE}/users/${encodeURIComponent(process.env.MS_MAIL_FROM)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message, saveToSentItems: true }),
    },
  );

  if (res.status !== 202) {
    const errBody = await res.text().catch(() => "");
    throw new Error(
      `[graph-mail] sendMail failed (${res.status}): ${errBody}`,
    );
  }

  return { messageId: null, previewUrl: null };
}

module.exports = { sendMail, isConfigured };
