const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const {
  list,
  get,
  adjust,
  receive,
  getTransactions,
} = require("../controllers/inventory.controller");

router.use(auth);

router.get("/items", list);
router.get("/items/:id", get);
router.post("/items/:id/adjust", requirePermission("inventory.manage"), adjust);
router.post(
  "/items/:id/receive",
  requirePermission("inventory.manage"),
  receive,
);
router.get("/items/:id/transactions", getTransactions);

module.exports = router;
