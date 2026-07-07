const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const c = require("../controllers/suppliers.controller");

router.use(auth);

// Supplier records and pricing have no legitimate technician use case.
// Reads are gated to whichever tier can manage suppliers directly, or needs
// to browse them from a related workflow (creating a PO, linking a supplier
// price to an inventory item) -- broader than the write gate so a custom
// role holding just purchasing.manage/inventory.manage doesn't silently
// break those pickers.
const canViewSuppliers = requirePermission(
  "suppliers.manage",
  "purchasing.manage",
  "inventory.manage",
);
router.get("/", canViewSuppliers, c.list);
router.get("/:id", canViewSuppliers, c.get);
router.post("/", requirePermission("suppliers.manage"), c.create);
router.put("/:id", requirePermission("suppliers.manage"), c.update);
router.delete("/:id", requirePermission("suppliers.manage"), c.remove);

module.exports = router;
