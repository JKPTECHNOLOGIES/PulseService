const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const c = require("../controllers/equipment.controller");

router.use(auth);

// `type` is intentionally free-text (customizable), so only the condition is
// validated against the DB-driven lookups.
const validateEquipment = validateLookups({
  condition: "equipmentCondition",
});

router.get("/", c.list);
router.post("/", validateEquipment, c.create);
router.get("/:id", c.get);
router.put("/:id", validateEquipment, c.update);
router.delete("/:id", c["delete"]);

module.exports = router;
