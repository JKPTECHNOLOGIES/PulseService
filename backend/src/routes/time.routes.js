const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const c = require("../controllers/time.controller");

router.use(auth);

// Any authenticated user can track their own time — no special permission.
router.get("/current", c.current);
router.post("/clock-in", c.clockIn);
router.post("/clock-out", c.clockOut);
router.get("/job/:jobId", c.listForJob);

module.exports = router;
