const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const c = require("../controllers/settings.controller");

router.use(auth);

const validateBusinessUnit = validateLookups({ type: "businessUnitType" });

// Business units (must come before '/' to avoid conflicts). Readable by all;
// editing is management-only.
router.get("/business-units", c.getBusinessUnits);
router.post(
  "/business-units",
  requirePermission("settings.manage"),
  validateBusinessUnit,
  c.createBusinessUnit,
);
router.put(
  "/business-units/:id",
  requirePermission("settings.manage"),
  validateBusinessUnit,
  c.updateBusinessUnit,
);
router.delete(
  "/business-units/:id",
  requirePermission("settings.manage"),
  c.deleteBusinessUnit,
);

// Company settings
router.get("/", c.get);
router.put("/", requirePermission("settings.manage"), c.update);

module.exports = router;
