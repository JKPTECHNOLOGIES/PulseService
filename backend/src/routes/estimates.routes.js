const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const c = require("../controllers/estimates.controller");

router.use(auth);

const validateEstimate = validateLookups({
  status: "estimateStatus",
  discountType: "discountType",
});

router.get("/", c.list);
router.post(
  "/",
  requirePermission("estimates.manage"),
  validateEstimate,
  c.create,
);
router.get("/:id", c.get);
router.get("/:id/pdf", c.getPdf);
router.put(
  "/:id",
  requirePermission("estimates.manage"),
  validateEstimate,
  c.update,
);

router.post("/:id/send", requirePermission("estimates.manage"), c.send);
router.post("/:id/approve", requirePermission("estimates.manage"), c.approve);
router.post("/:id/reject", requirePermission("estimates.manage"), c.reject);
router.post(
  "/:id/convert",
  requirePermission("estimates.manage"),
  c.convertToInvoice,
);

module.exports = router;
