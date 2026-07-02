const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const c = require("../controllers/geocode.controller");

router.use(auth);

router.post("/backfill", requirePermission("customers.edit"), c.backfill);

module.exports = router;
