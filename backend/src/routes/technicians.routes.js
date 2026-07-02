const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const {
  list,
  get,
  updateLocation,
  getAvailability,
  getMyJobs,
} = require("../controllers/technicians.controller");

router.use(auth);

router.get("/", list);
// Self-scoped agenda — must precede '/:id' so "me" isn't treated as an id.
router.get("/me/jobs", getMyJobs);
router.get("/:id", get);
router.patch("/:id/location", updateLocation);
router.get("/:id/availability", getAvailability);

module.exports = router;
