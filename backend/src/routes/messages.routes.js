const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const c = require("../controllers/messages.controller");

router.use(auth);

const validateMessage = validateLookups({
  direction: "messageDirection",
  channel: "messageChannel",
});

router.get("/", c.list);
router.post("/", requirePermission("calls.manage"), validateMessage, c.create);
router.delete("/:id", requirePermission("calls.manage"), c.remove);

module.exports = router;
