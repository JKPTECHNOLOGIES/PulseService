const nodemailer = require("nodemailer");
const graphMail = require("./graph-mail.service");

// A single transport is created lazily and cached. If SMTP_* env vars are set we
// use the real mail server; otherwise we fall back to an Ethereal test inbox so
// the "send" feature is fully demoable without real credentials (no message is
// actually delivered — Ethereal returns a preview URL instead).
let cachedTransport = null;
let usingEthereal = false;

async function getTransport() {
  if (cachedTransport) return cachedTransport;

  if (process.env.SMTP_HOST) {
    cachedTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
    usingEthereal = false;
  } else {
    const testAccount = await nodemailer.createTestAccount();
    cachedTransport = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: { user: testAccount.user, pass: testAccount.pass },
    });
    usingEthereal = true;
    console.log(
      "[email] SMTP not configured — using Ethereal test inbox. " +
        "Sent emails are not delivered; a preview URL is returned instead.",
    );
  }
  return cachedTransport;
}

/**
 * Sends an email and returns `{ messageId, previewUrl }`. `previewUrl` is only
 * populated when running against the Ethereal test inbox (no real SMTP).
 *
 * When MS_TENANT_ID/MS_CLIENT_ID/MS_CLIENT_SECRET/MS_MAIL_FROM are set, mail
 * is sent through Microsoft Graph (app-only OAuth2) instead of SMTP — this
 * takes priority since it's the modern, supported path for Microsoft 365.
 */
async function sendMail({ to, subject, text, html, attachments }) {
  if (graphMail.isConfigured()) {
    return graphMail.sendMail({ to, subject, text, html, attachments });
  }

  const transport = await getTransport();
  const from =
    process.env.SMTP_FROM ||
    "Prime Comfort Solutions <no-reply@primecomfortac.com>";
  const info = await transport.sendMail({
    from,
    to,
    subject,
    text,
    html,
    attachments,
  });
  return {
    messageId: info.messageId,
    previewUrl: usingEthereal ? nodemailer.getTestMessageUrl(info) : null,
  };
}

module.exports = { sendMail };
