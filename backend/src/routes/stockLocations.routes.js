const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const c = require("../controllers/stockLocations.controller");

router.use(auth);

router.get("/", c.list);
router.get("/:id", c.get);
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
