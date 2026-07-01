const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const c = require("../controllers/invoices.controller");

router.use(auth);

const validateInvoice = validateLookups({
  status: "invoiceStatus",
  discountType: "discountType",
});

router.get("/", c.list);
router.post(
  "/",
  requirePermission("invoices.manage"),
  validateInvoice,
  c.create,
);
router.get("/:id", c.get);
router.put(
  "/:id",
  requirePermission("invoices.manage"),
  validateInvoice,
  c.update,
);

router.post("/:id/send", requirePermission("invoices.manage"), c.send);
router.post(
  "/:id/payments",
  requirePermission("invoices.manage"),
  validateLookups({ method: "paymentMethod" }),
  c.recordPayment,
);
router.post("/:id/void", requirePermission("invoices.void"), c["void"]);

module.exports = router;
