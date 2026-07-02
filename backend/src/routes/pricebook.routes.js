const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const c = require("../controllers/pricebook.controller");

router.use(auth);

// The catalog is readable by everyone (needed for estimate/invoice line items);
// editing it requires the pricebook.manage permission.
// Categories
router.get("/categories", c.listCategories);
router.post(
  "/categories",
  requirePermission("pricebook.manage"),
  c.createCategory,
);
router.put(
  "/categories/:id",
  requirePermission("pricebook.manage"),
  c.updateCategory,
);
router.delete(
  "/categories/:id",
  requirePermission("pricebook.manage"),
  c.deleteCategory,
);

// Items
router.get("/items", c.listItems);
router.post("/items", requirePermission("pricebook.manage"), c.createItem);
router.post(
  "/items/import",
  requirePermission("pricebook.manage"),
  c.importItems,
);
router.put("/items/:id", requirePermission("pricebook.manage"), c.updateItem);
router.delete(
  "/items/:id",
  requirePermission("pricebook.manage"),
  c.deleteItem,
);

module.exports = router;
