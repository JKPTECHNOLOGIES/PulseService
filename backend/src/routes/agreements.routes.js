const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const {
  list,
  get,
  create,
  update,
  scheduleVisit,
  completeVisit,
} = require("../controllers/agreements.controller");

router.use(auth);

router.get("/", list);
router.post("/", requirePermission("agreements.manage"), create);
router.get("/:id", get);
router.put("/:id", requirePermission("agreements.manage"), update);

router.post(
  "/:id/visits",
  requirePermission("agreements.visits"),
  scheduleVisit,
);
router.put(
  "/:id/visits/:visitId/complete",
  requirePermission("agreements.visits"),
  completeVisit,
);

module.exports = router;
