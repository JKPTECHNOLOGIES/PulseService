const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const c = require("../controllers/time.controller");

router.use(auth);

// Any authenticated user can track their own time — no special permission.
router.get("/current", c.current);
router.post("/clock-in", c.clockIn);
router.post("/clock-out", c.clockOut);
router.get("/job/:jobId", c.listForJob);

// Manually adding/editing/removing entries (assigning hours on someone
// else's behalf) is an admin-level capability, gated by time.manage.
router.post("/", requirePermission("time.manage"), c.create);
router.put("/:id", requirePermission("time.manage"), c.update);
router.delete("/:id", requirePermission("time.manage"), c.remove);

module.exports = router;
