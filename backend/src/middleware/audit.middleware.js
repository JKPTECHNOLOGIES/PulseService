const prisma = require("../config/database");

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ACTION_BY_METHOD = {
  POST: "create",
  PUT: "update",
  PATCH: "update",
  DELETE: "delete",
};

// Trailing path segments that describe a specific action rather than an id.
const NAMED_ACTIONS = new Set([
  "void",
  "send",
  "approve",
  "reject",
  "convert",
  "reassign",
  "reset-password",
  "mark-read",
  "adjust",
  "receive",
  "complete",
  "login",
  "password",
  "permissions",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sensitive fields that must never be persisted in the audit metadata.
const REDACT = new Set(["password", "currentPassword", "newPassword", "token"]);

function summarizeBody(body) {
  if (!body || typeof body !== "object") return null;
  try {
    const clean = {};
    for (const [key, value] of Object.entries(body)) {
      if (REDACT.has(key)) continue;
      clean[key] = value;
    }
    const json = JSON.stringify(clean);
    return json.length > 1000 ? `${json.slice(0, 1000)}…` : json;
  } catch {
    return null;
  }
}

/**
 * Records every successful mutating request (POST/PUT/PATCH/DELETE) to the
 * AuditLog table. Registered globally under /api/v1 so it captures actions
 * across all resources without each controller having to opt in. Writes happen
 * after the response is sent and never block or fail the request.
 */
module.exports = (req, res, next) => {
  if (!MUTATING.has(req.method)) return next();

  // Snapshot the body now; some handlers mutate req.body.
  const bodySummary = summarizeBody(req.body);
  const email = req.body && typeof req.body === "object" ? req.body.email : null;

  res.on("finish", () => {
    if (res.statusCode >= 400) return;

    // /api/v1/<entity>/<maybeId>/<maybeAction>
    const segments = req.originalUrl.split("?")[0].split("/").filter(Boolean);
    const rest = segments.slice(2); // drop "api", "v1"
    const entity = rest[0] ?? null;
    const entityId = rest[1] && UUID_RE.test(rest[1]) ? rest[1] : null;

    const last = rest[rest.length - 1];
    const action =
      last && NAMED_ACTIONS.has(last) ? last : ACTION_BY_METHOD[req.method];

    prisma.auditLog
      .create({
        data: {
          userId: req.user?.id ?? null,
          userEmail: req.user?.email ?? email ?? null,
          userRole: req.user?.role ?? null,
          action,
          method: req.method,
          path: `/${rest.join("/")}`,
          entity,
          entityId,
          statusCode: res.statusCode,
          metadata: bodySummary,
          ip: req.ip ?? null,
        },
      })
      .catch((err) => {
        console.error("audit log write error:", err);
      });
  });

  next();
};
