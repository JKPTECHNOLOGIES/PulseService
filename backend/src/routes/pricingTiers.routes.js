const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const c = require("../controllers/pricingTiers.controller");

router.use(auth);

const validateTier = validateLookups({ discountType: "discountType" });
const validateOverride = validateLookups({ overrideType: "pricingOverrideType" });

router.get("/", c.list);
router.get("/:id", c.get);
router.post("/", requirePermission("pricebook.manage"), validateTier, c.create);
router.put("/:id", requirePermission("pricebook.manage"), validateTier, c.update);
router.delete("/:id", requirePermission("pricebook.manage"), c.remove);

router.post(
  "/:id/overrides",
  requirePermission("pricebook.manage"),
  validateOverride,
  c.addOverride,
);
router.delete(
  "/:id/overrides/:overrideId",
  requirePermission("pricebook.manage"),
  c.removeOverride,
);

module.exports = router;
