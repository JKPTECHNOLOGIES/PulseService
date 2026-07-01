const crypto = require("crypto");

// Stateless, unguessable token for public (no-login) links, derived by HMAC from
// the record id and the server secret. No DB column needed: the server can
// recompute and verify it. Scope-prefixed so an estimate token can't be reused
// for another resource type.
const secret = () => process.env.JWT_SECRET || "pulseservice-dev-secret";

function publicToken(scope, id) {
  return crypto
    .createHmac("sha256", secret())
    .update(`${scope}:${id}`)
    .digest("hex")
    .slice(0, 32);
}

function verifyPublicToken(scope, id, token) {
  if (!token) return false;
  const expected = publicToken(scope, id);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { publicToken, verifyPublicToken };
