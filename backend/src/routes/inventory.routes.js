const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const c = require("../controllers/inventory.controller");

router.use(auth);

// Items (catalog + aggregated stock). The list stays open to any
// authenticated user (e.g. AddPartModal needs it for a technician to pick a
// part) but strips wholesale cost for non-managers -- see canSeeCost in the
// controller. Single-item detail (supplier cost links, cost history) and
// transaction history are admin-only views (only ever opened from
// InventoryPage's own management modals), so those are fully gated.
router.get("/items", c.list);
router.post("/items", requirePermission("inventory.manage"), c.create);
router.post(
  "/items/import",
  requirePermission("inventory.manage"),
  c.importItems,
);
router.get("/items/:id", requirePermission("inventory.manage"), c.get);
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
router.get(
  "/items/:id/transactions",
  requirePermission("inventory.manage"),
  c.getTransactions,
);

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

// Job parts consumption. Techs get a scoped permission for this one action
// (issuing already-stocked parts to a job they're working) without the full
// inventory.manage rights (item CRUD, adjustments, transfers).
router.post(
  "/issue",
  requirePermission("inventory.manage", "inventory.issueToJob"),
  c.issueToJob,
);
router.get("/jobs/:jobId/parts", c.getJobParts);
// Scoped to job-parts issuances only for the inventory.issueToJob tier --
// see the controller for the ownership/type check that enforces this.
router.post(
  "/transactions/:id/reverse",
  requirePermission("inventory.manage", "inventory.issueToJob"),
  c.reverseTransaction,
);

// Cycle count
router.post(
  "/cycle-count",
  requirePermission("inventory.manage"),
  c.cycleCount,
);

module.exports = router;
