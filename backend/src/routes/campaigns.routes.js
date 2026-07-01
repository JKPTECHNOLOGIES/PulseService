const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const c = require("../controllers/campaigns.controller");

router.use(auth);

const validateCampaign = validateLookups({
  type: "campaignType",
  status: "campaignStatus",
});

router.get("/", c.list);
router.post(
  "/",
  requirePermission("campaigns.manage"),
  validateCampaign,
  c.create,
);
router.put(
  "/:id",
  requirePermission("campaigns.manage"),
  validateCampaign,
  c.update,
);
router.delete("/:id", requirePermission("campaigns.manage"), c["delete"]);

module.exports = router;
