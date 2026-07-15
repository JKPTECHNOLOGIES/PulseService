const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const c = require("../controllers/vendors.controller");

router.use(auth);

// Vendor records and pricing have no legitimate technician use case.
// Reads are gated to whichever tier can manage vendors directly, or needs
// to browse them from a related workflow (creating a PO, linking a vendor
// price to an inventory item) -- broader than the write gate so a custom
// role holding just purchasing.manage/inventory.manage doesn't silently
// break those pickers.
const canViewVendors = requirePermission(
  "vendors.manage",
  "purchasing.manage",
  "inventory.manage",
);
router.get("/", canViewVendors, c.list);
router.get("/:id", canViewVendors, c.get);
router.post("/", requirePermission("vendors.manage"), c.create);
router.put("/:id", requirePermission("vendors.manage"), c.update);
router.delete("/:id", requirePermission("vendors.manage"), c.remove);

module.exports = router;
