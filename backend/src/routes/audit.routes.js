const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const c = require("../controllers/audit.controller");

router.use(auth);
router.use(requirePermission("audit.view"));

router.get("/", c.list);

module.exports = router;
