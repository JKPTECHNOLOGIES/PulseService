const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const {
  list,
  get,
  getPdf,
  create,
  update,
  send,
  scheduleVisit,
  completeVisit,
} = require("../controllers/agreements.controller");

router.use(auth);

router.get("/", list);
router.post("/", requirePermission("agreements.manage"), create);
router.get("/:id", get);
router.get("/:id/pdf", getPdf);
router.put("/:id", requirePermission("agreements.manage"), update);

router.post("/:id/send", requirePermission("agreements.manage"), send);

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
