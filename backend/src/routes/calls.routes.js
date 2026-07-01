const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const {
  list,
  get,
  create,
  update,
} = require("../controllers/calls.controller");

router.use(auth);

const validateCall = validateLookups({
  direction: "callDirection",
  status: "callStatus",
});

router.get("/", list);
router.post("/", requirePermission("calls.manage"), validateCall, create);
router.get("/:id", get);
router.put("/:id", requirePermission("calls.manage"), validateCall, update);

module.exports = router;
