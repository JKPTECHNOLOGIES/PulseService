const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const c = require("../controllers/timeline.controller");

router.use(auth);

// Reads open to any authenticated user, same as the customer record itself
// -- this is the narrower, friendlier per-customer view of "what happened,"
// not the sensitive company-wide Activity Log (which stays audit.view-gated).
router.get("/", c.list);

module.exports = router;
