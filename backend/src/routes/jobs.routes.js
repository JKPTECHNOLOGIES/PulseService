const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const validateBody = require("../middleware/validateBody.middleware");
const c = require("../controllers/jobs.controller");

router.use(auth);

const validateJob = validateLookups({
  status: "jobStatus",
  type: "jobType",
  priority: "jobPriority",
});

router.get("/", c.list);
router.post(
  "/",
  requirePermission("jobs.create"),
  validateBody({ required: ["customerId", "summary"] }),
  validateJob,
  c.create,
);
router.get("/:id", c.get);
router.put("/:id", requirePermission("jobs.edit"), validateJob, c.update);
router.delete("/:id", requirePermission("jobs.delete"), c["delete"]);
router.patch(
  "/:id/status",
  requirePermission("jobs.status"),
  validateLookups({ status: "jobStatus" }),
  c.updateStatus,
);

router.post(
  "/:id/technicians",
  requirePermission("jobs.assign"),
  c.assignTechnician,
);
router.delete(
  "/:id/technicians/:techId",
  requirePermission("jobs.assign"),
  c.removeTechnician,
);

module.exports = router;
