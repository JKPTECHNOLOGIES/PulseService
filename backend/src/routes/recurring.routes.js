const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const c = require("../controllers/recurring.controller");

router.use(auth);

router.get("/", c.list);
router.post("/", requirePermission("jobs.create"), c.create);
router.post("/run-due", requirePermission("jobs.create"), c.runDue);
router.put("/:id", requirePermission("jobs.create"), c.update);
router.delete("/:id", requirePermission("jobs.create"), c.remove);
router.post("/:id/generate", requirePermission("jobs.create"), c.generate);

module.exports = router;
