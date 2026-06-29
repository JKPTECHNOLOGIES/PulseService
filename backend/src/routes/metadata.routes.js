const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const c = require("../controllers/metadata.controller");

router.use(auth);

router.get("/", c.getMetadata);
router.get("/:category", c.getCategory);

module.exports = router;
