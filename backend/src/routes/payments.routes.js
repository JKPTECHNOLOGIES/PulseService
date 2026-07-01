const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const { list } = require("../controllers/payments.controller");

router.use(auth);

router.get("/", requirePermission("payments.view"), list);

module.exports = router;
