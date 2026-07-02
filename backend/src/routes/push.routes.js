const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const c = require("../controllers/push.controller");

router.use(auth);

router.get("/vapid-public-key", c.publicKey);
router.post("/subscribe", c.subscribe);
router.post("/unsubscribe", c.unsubscribe);
router.post("/test", c.test);

module.exports = router;
