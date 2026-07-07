const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const {
  list,
  get,
  getAvailability,
  getMyJobs,
} = require("../controllers/technicians.controller");

router.use(auth);

router.get("/", list);
// Self-scoped agenda — must precede '/:id' so "me" isn't treated as an id.
router.get("/me/jobs", getMyJobs);
router.get("/:id", get);
// NB: the live GPS-broadcast write endpoint (PATCH /:id/location) was removed
// -- it had no frontend consumer (no geolocation watcher ever called it, no
// UI ever listened for the technician:location socket event it broadcast)
// and no permission guard, so it was pure unguarded attack surface. The
// currentLat/currentLng fields it would have updated are still read and
// displayed (dispatch board / Map page) from whatever was last seeded.
router.get("/:id/availability", getAvailability);

module.exports = router;
