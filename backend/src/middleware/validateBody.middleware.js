/**
 * Express middleware factory that rejects requests missing required body
 * fields with a clean 400, instead of letting them reach Prisma and surface as
 * an opaque 500. Mirrors the validateLookups pattern.
 *
 * @example
 *   router.post("/", validateBody({ required: ["firstName", "phone"] }), c.create);
 */
function validateBody({ required = [] } = {}) {
  return (req, res, next) => {
    const body = req.body ?? {};
    const missing = required.filter((field) => {
      const value = body[field];
      return (
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim() === "")
      );
    });

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required field${
          missing.length > 1 ? "s" : ""
        }: ${missing.join(", ")}`,
      });
    }

    next();
  };
}

module.exports = validateBody;
