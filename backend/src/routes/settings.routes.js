const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const c = require("../controllers/settings.controller");

router.use(auth);

const validateBusinessUnit = validateLookups({ type: "businessUnitType" });

// Business units (must come before '/' to avoid conflicts)
router.get("/business-units", c.getBusinessUnits);
router.post("/business-units", validateBusinessUnit, c.createBusinessUnit);
router.put("/business-units/:id", validateBusinessUnit, c.updateBusinessUnit);
router.delete("/business-units/:id", c.deleteBusinessUnit);

// Company settings
router.get("/", c.get);
router.put("/", c.update);

module.exports = router;
