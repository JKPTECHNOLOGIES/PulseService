const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const c = require("../controllers/jobs.controller");

router.use(auth);

const validateJob = validateLookups({
  status: "jobStatus",
  type: "jobType",
  priority: "jobPriority",
});

router.get("/", c.list);
router.post("/", validateJob, c.create);
router.get("/:id", c.get);
router.put("/:id", validateJob, c.update);
router.delete("/:id", c["delete"]);
router.patch(
  "/:id/status",
  validateLookups({ status: "jobStatus" }),
  c.updateStatus,
);

router.post("/:id/technicians", c.assignTechnician);
router.delete("/:id/technicians/:techId", c.removeTechnician);

module.exports = router;
