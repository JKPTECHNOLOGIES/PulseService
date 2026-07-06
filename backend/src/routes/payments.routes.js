const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const { list, reversePayment } = require("../controllers/payments.controller");

router.use(auth);

router.get("/", requirePermission("payments.view"), list);
// Same permission tier as voiding an invoice -- undoing recorded money is
// just as sensitive as voiding the document it was applied to.
router.post("/:id/reverse", requirePermission("invoices.void"), reversePayment);

module.exports = router;
