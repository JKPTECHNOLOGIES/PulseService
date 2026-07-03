const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const c = require("../controllers/inventory.controller");

router.use(auth);

// Items (catalog + aggregated stock)
router.get("/items", c.list);
router.post("/items", requirePermission("inventory.manage"), c.create);
router.post(
  "/items/import",
  requirePermission("inventory.manage"),
  c.importItems,
);
router.get("/items/:id", c.get);
router.put("/items/:id", requirePermission("inventory.manage"), c.update);
router.delete("/items/:id", requirePermission("inventory.manage"), c.remove);

// Stock movements
router.post(
  "/items/:id/adjust",
  requirePermission("inventory.manage"),
  c.adjust,
);
router.post(
  "/items/:id/transfer",
  requirePermission("inventory.manage"),
  c.transfer,
);
router.get("/items/:id/transactions", c.getTransactions);

// Per-supplier catalog pricing
router.post(
  "/items/:id/suppliers",
  requirePermission("inventory.manage"),
  c.addSupplier,
);
router.delete(
  "/items/:id/suppliers/:linkId",
  requirePermission("inventory.manage"),
  c.removeSupplier,
);

// Job parts consumption
router.post("/issue", requirePermission("inventory.manage"), c.issueToJob);
router.get("/jobs/:jobId/parts", c.getJobParts);
router.post(
  "/transactions/:id/reverse",
  requirePermission("inventory.manage"),
  c.reverseTransaction,
);

// Cycle count
router.post(
  "/cycle-count",
  requirePermission("inventory.manage"),
  c.cycleCount,
);

module.exports = router;
