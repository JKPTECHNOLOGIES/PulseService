const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const { getBoard, reassign } = require("../controllers/dispatch.controller");

router.use(auth);

router.get("/board", getBoard);
router.post("/reassign", requirePermission("dispatch.manage"), reassign);

module.exports = router;
