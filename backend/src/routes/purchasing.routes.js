const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const c = require("../controllers/purchasing.controller");

router.use(auth);

router.get("/purchase-orders", c.list);
router.get("/purchase-orders/:id", c.get);
router.post("/purchase-orders", requirePermission("purchasing.manage"), c.create);
router.put("/purchase-orders/:id", requirePermission("purchasing.manage"), c.update);
router.put(
  "/purchase-orders/:id/status",
  requirePermission("purchasing.manage"),
  validateLookups({ status: "poStatus" }),
  c.setStatus,
);
router.post(
  "/purchase-orders/:id/receive-items",
  requirePermission("purchasing.receive"),
  c.receiveItems,
);
router.post(
  "/purchase-orders/:id/receipts/:receiptId/reverse",
  requirePermission("purchasing.receive"),
  c.reverseReceipt,
);

module.exports = router;
