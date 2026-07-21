const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const prisma = require("../config/database");
const { nextEmployeeId } = require("../utils/helpers");
const microsoftAuth = require("../services/microsoftAuth.service");

// Defense in depth: even though the app registration should be restricted to
// a single tenant in Azure, also check the email domain here so a tenant
// misconfiguration can't let an unexpected mailbox auto-provision an account.
const ALLOWED_EMAIL_DOMAIN = "primecomfortac.com";

const STATE_PURPOSE = "ms-oauth-state";

function frontendUrl(path) {
  const base = process.env.FRONTEND_URL || "http://localhost:3000";
  return `${base}${path}`;
}

// Kicks off the redirect to Microsoft's login page. `state` is a short-lived
// signed JWT (not a DB/session record) so this stays stateless like the rest
// of the API -- it's verified on callback to guard against CSRF.
const login = (req, res) => {
  if (!microsoftAuth.isConfigured()) {
    return res
      .status(503)
      .send("Microsoft sign-in is not configured on this server.");
  }
  const state = jwt.sign(
    { purpose: STATE_PURPOSE, nonce: crypto.randomBytes(8).toString("hex") },
    process.env.JWT_SECRET,
    { expiresIn: "10m" },
  );
  return res.redirect(microsoftAuth.buildAuthorizeUrl(state));
};

// Handles Microsoft's redirect back after login. On success, issues our own
// app JWT exactly like the password login path and hands it to the frontend
// via a URL fragment (never sent to servers/logs, unlike a query string).
const callback = async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    console.warn("[microsoft-auth] callback error:", error, errorDescription);
    return res.redirect(
      frontendUrl(`/login?error=microsoft_${encodeURIComponent(error)}`),
    );
  }

  try {
    const decoded = jwt.verify(state, process.env.JWT_SECRET);
    if (decoded.purpose !== STATE_PURPOSE) throw new Error("wrong purpose");
  } catch {
    return res.redirect(frontendUrl("/login?error=invalid_state"));
  }

  try {
    const tokens = await microsoftAuth.exchangeCodeForTokens(code);
    const profile = await microsoftAuth.getProfile(tokens.access_token);

    const email = (profile.mail || profile.userPrincipalName || "").toLowerCase();
    if (!email) {
      return res.redirect(frontendUrl("/login?error=no_email"));
    }
    if (!email.endsWith(`@${ALLOWED_EMAIL_DOMAIN}`)) {
      return res.redirect(frontendUrl("/login?error=domain_not_allowed"));
    }

    let user = await prisma.user.findUnique({ where: { email } });

    if (user && !user.isActive) {
      return res.redirect(frontendUrl("/login?error=account_disabled"));
    }

    if (!user) {
      // Auto-provision: least-privileged role (technician). A real admin
      // account is never created by this flow. Also creates a bare
      // Technician profile, same as an admin manually inviting a technician
      // via the Users page, so they immediately appear on the dispatch board.
      user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            email,
            password: null,
            firstName: profile.givenName || profile.displayName || "New",
            lastName: profile.surname || "",
            role: "technician",
            entraObjectId: profile.id,
          },
        });
        await tx.technician.create({
          data: { userId: created.id, employeeId: await nextEmployeeId(tx) },
        });
        return created;
      });
    } else if (!user.entraObjectId) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { entraObjectId: profile.id },
      });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
    );

    return res.redirect(`${frontendUrl("/auth/microsoft/callback")}#token=${token}`);
  } catch (err) {
    console.error("[microsoft-auth] callback failed:", err);
    return res.redirect(frontendUrl("/login?error=microsoft_login_failed"));
  }
};

module.exports = { login, callback };
