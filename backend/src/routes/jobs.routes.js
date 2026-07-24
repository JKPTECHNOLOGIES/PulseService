const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const validateBody = require("../middleware/validateBody.middleware");
const c = require("../controllers/jobs.controller");

router.use(auth);

// Job type is intentionally NOT validated against a fixed lookup -- the office
// can type a new service type straight into the job form and it's saved as-is
// (see c.types, which surfaces distinct values already in use as suggestions).
const validateJob = validateLookups({
  status: "jobStatus",
  priority: "jobPriority",
  source: "leadSource",
});

router.get("/", c.list);
router.get("/types", c.types);
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
// Archive/unarchive reuse the same permission tier as delete -- they're the
// safe, reversible alternative to it, not a separate looser action.
router.post("/:id/archive", requirePermission("jobs.delete"), c.archive);
router.post("/:id/unarchive", requirePermission("jobs.delete"), c.unarchive);
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
