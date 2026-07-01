const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const { globalSearch } = require("../controllers/search.controller");

router.use(auth);

router.get("/", globalSearch);

module.exports = router;
