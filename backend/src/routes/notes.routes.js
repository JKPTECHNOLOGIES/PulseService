const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const c = require("../controllers/notes.controller");

router.use(auth);

// Adding/pinning a note is low-friction by design (same philosophy as
// attachments) -- any authenticated user working with a customer can leave
// one. Only deleting is worth a moment's thought, so it stays here too but
// nothing calls it from the UI yet (kept for admin/API cleanup use).
router.post("/", c.create);
router.patch("/:id/pin", c.setPinned);
router.delete("/:id", c.remove);

module.exports = router;
