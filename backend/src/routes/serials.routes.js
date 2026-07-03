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
router.post("/:id/install", requirePermission("inventory.manage"), c.install);

module.exports = router;
