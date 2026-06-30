const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const c = require("../controllers/campaigns.controller");

router.use(auth);

const validateCampaign = validateLookups({
  type: "campaignType",
  status: "campaignStatus",
});

router.get("/", c.list);
router.post("/", validateCampaign, c.create);
router.put("/:id", validateCampaign, c.update);
router.delete("/:id", c["delete"]);

module.exports = router;
