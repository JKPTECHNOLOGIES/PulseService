const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const c = require("../controllers/invoices.controller");

router.use(auth);

const validateInvoice = validateLookups({
  status: "invoiceStatus",
  discountType: "discountType",
});

router.get("/", c.list);
router.post("/", validateInvoice, c.create);
router.get("/:id", c.get);
router.put("/:id", validateInvoice, c.update);

router.post("/:id/send", c.send);
router.post(
  "/:id/payments",
  validateLookups({ method: "paymentMethod" }),
  c.recordPayment,
);
router.post("/:id/void", c["void"]);

module.exports = router;
