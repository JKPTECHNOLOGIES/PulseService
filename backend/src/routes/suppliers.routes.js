const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const c = require("../controllers/suppliers.controller");

router.use(auth);

router.get("/", c.list);
router.get("/:id", c.get);
router.post("/", requirePermission("suppliers.manage"), c.create);
router.put("/:id", requirePermission("suppliers.manage"), c.update);
router.delete("/:id", requirePermission("suppliers.manage"), c.remove);

module.exports = router;
