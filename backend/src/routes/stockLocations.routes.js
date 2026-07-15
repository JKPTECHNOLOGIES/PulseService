const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const c = require("../controllers/stockLocations.controller");

router.use(auth);

// No cost data lives on a stock location itself, so this is a lighter gate
// than purchasing/vendors -- just excludes roles with zero inventory-
// adjacent reason to see truck/warehouse locations (csr, exec), while still
// covering technicians (they need this to pick their truck in AddPartModal).
const canViewLocations = requirePermission(
  "inventory.manage",
  "inventory.issueToJob",
  "purchasing.manage",
  "purchasing.receive",
  "vendors.manage",
);
router.get("/", canViewLocations, c.list);
router.get("/vehicles", canViewLocations, c.vehicles);
router.get("/:id", canViewLocations, c.get);
router.post(
  "/",
  requirePermission("inventory.manage"),
  validateLookups({ type: "stockLocationType" }),
  c.create,
);
router.put(
  "/:id",
  requirePermission("inventory.manage"),
  validateLookups({ type: "stockLocationType" }),
  c.update,
);
router.delete("/:id", requirePermission("inventory.manage"), c.remove);

module.exports = router;
