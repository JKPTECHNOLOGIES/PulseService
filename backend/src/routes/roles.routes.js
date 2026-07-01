const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const c = require("../controllers/roles.controller");

// Role administration is bundled with user management.
router.use(auth);
router.use(requirePermission("users.manage"));

router.get("/catalog", c.catalog);
router.get("/", c.list);
router.put("/:role/permissions", c.updatePermissions);

module.exports = router;
