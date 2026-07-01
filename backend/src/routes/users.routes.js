const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const c = require("../controllers/users.controller");

// User & role administration.
router.use(auth);
router.use(requirePermission("users.manage"));

const validateRole = validateLookups({ role: "userRole" });

router.get("/", c.list);
router.get("/:id", c.get);
router.post("/", validateRole, c.create);
router.put("/:id", validateRole, c.update);
router.post("/:id/reset-password", c.resetPassword);

module.exports = router;
