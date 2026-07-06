const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const c = require("../controllers/serials.controller");

router.use(auth);

router.get("/", c.list);
router.get("/:id", c.get);
router.post(
  "/",
  requirePermission("inventory.manage"),
  validateLookups({ status: "serializedUnitStatus" }),
  c.create,
);
router.put(
  "/:id",
  requirePermission("inventory.manage"),
  validateLookups({ status: "serializedUnitStatus" }),
  c.update,
);
// Installing a unit on a job is a field action techs need; scoped separately
// from the broader inventory.manage rights (create/edit serial records).
router.post(
  "/:id/install",
  requirePermission("inventory.manage", "inventory.issueToJob"),
  c.install,
);
// Reverse an install (return the unit to stock / remove it from a job).
router.post(
  "/:id/uninstall",
  requirePermission("inventory.manage", "inventory.issueToJob"),
  c.uninstall,
);

module.exports = router;
