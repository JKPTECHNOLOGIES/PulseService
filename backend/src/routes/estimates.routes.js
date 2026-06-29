const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const validateLookups = require("../middleware/validateLookups.middleware");
const c = require("../controllers/estimates.controller");

router.use(auth);

const validateEstimate = validateLookups({
  status: "estimateStatus",
  discountType: "discountType",
});

router.get("/", c.list);
router.post("/", validateEstimate, c.create);
router.get("/:id", c.get);
router.put("/:id", validateEstimate, c.update);

router.post("/:id/send", c.send);
router.post("/:id/approve", c.approve);
router.post("/:id/reject", c.reject);
router.post("/:id/convert", c.convertToInvoice);

module.exports = router;
