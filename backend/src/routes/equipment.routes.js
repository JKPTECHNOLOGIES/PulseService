const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { requirePermission } = require("../middleware/permission.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const c = require("../controllers/equipment.controller");

router.use(auth);

// `type` is intentionally free-text (customizable), so only the condition is
// validated against the DB-driven lookups.
const validateEquipment = validateLookups({
  condition: "equipmentCondition",
});

router.get("/", c.list);
// Technicians document equipment in the field, so create/update stay open; only
// deletion is restricted.
router.post("/", validateEquipment, c.create);
router.get("/:id", c.get);
router.put("/:id", validateEquipment, c.update);
router.delete("/:id", requirePermission("equipment.delete"), c["delete"]);

module.exports = router;
