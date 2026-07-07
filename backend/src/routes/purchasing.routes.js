const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const c = require("../controllers/purchasing.controller");

router.use(auth);

// Purchasing data (costs, supplier pricing, receiving history) has no
// legitimate technician use case, unlike inventory items/serials/stock
// locations -- gate every read the same as the writes.
const canViewPurchasing = requirePermission(
  "purchasing.manage",
  "purchasing.receive",
);
router.get("/purchase-orders", canViewPurchasing, c.list);
router.get("/reorder-suggestions", canViewPurchasing, c.reorderSuggestions);
router.get("/purchase-orders/:id", canViewPurchasing, c.get);
router.post(
  "/purchase-orders",
  requirePermission("purchasing.manage"),
  c.create,
);
router.put(
  "/purchase-orders/:id",
  requirePermission("purchasing.manage"),
  c.update,
);
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
