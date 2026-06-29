const lookupsService = require("../services/lookups.service");

/**
 * Express middleware factory that validates request-body fields against the
 * DB-driven Lookup table. Pass a map of `{ bodyField: lookupCategory }`.
 *
 * Only fields that are present (not undefined/null/empty) are checked, so it
 * works for both creates and partial updates. Invalid values yield a 400.
 *
 * @example
 *   router.post("/", validateLookups({ status: "jobStatus", type: "jobType" }), c.create);
 */
function validateLookups(fieldMap) {
  const entries = Object.entries(fieldMap);
  return async (req, res, next) => {
    try {
      const body = req.body ?? {};
      for (const [field, category] of entries) {
        const value = body[field];
        if (value === undefined || value === null || value === "") continue;
        const ok = await lookupsService.isValid(category, value);
        if (!ok) {
          return res.status(400).json({
            success: false,
            error: `Invalid ${field}: '${value}' is not a valid ${category}.`,
          });
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = validateLookups;
