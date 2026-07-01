const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const {
  revenue,
  jobs,
  technicians,
  customers,
  arAging,
} = require("../controllers/reports.controller");

router.use(auth);

router.get("/revenue", requirePermission("reports.financial"), revenue);
router.get("/jobs", requirePermission("reports.operational"), jobs);
router.get(
  "/technicians",
  requirePermission("reports.operational"),
  technicians,
);
router.get("/customers", requirePermission("reports.financial"), customers);
router.get("/ar-aging", requirePermission("reports.financial"), arAging);

module.exports = router;
