const permissionsService = require("../services/permissions.service");

/**
 * Express middleware factory that authorizes a request against the DB-driven
 * role -> permission mapping. Pass one or more permission keys; access is
 * granted if the user's role holds ANY of them.
 *
 * @example
 *   router.post("/:id/void", requirePermission("invoices.void"), c.void);
 */
function requirePermission(...permissions) {
  const needed = permissions.flat();
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }
      const granted = await permissionsService.getForRole(req.user.role);
      const ok = needed.some((p) => granted.includes(p));
      if (!ok) {
        return res.status(403).json({
          success: false,
          error: `Access denied. Requires permission: ${needed.join(" or ")}`,
        });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requirePermission };
