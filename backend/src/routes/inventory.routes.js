const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
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
router.post("/items/:id/adjust", adjust);
router.post("/items/:id/receive", receive);
router.get("/items/:id/transactions", getTransactions);

module.exports = router;
