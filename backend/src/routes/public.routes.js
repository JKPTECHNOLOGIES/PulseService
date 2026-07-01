const router = require("express").Router();
const c = require("../controllers/public.controller");

// NOTE: no auth middleware here — these are public, token-gated endpoints for
// customer-facing estimate approval links.
router.get("/estimates/:id", c.getEstimate);
router.post("/estimates/:id/approve", c.approveEstimate);
router.post("/estimates/:id/reject", c.rejectEstimate);

module.exports = router;
