const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const {
  login,
  getMe,
  updateProfile,
  changePassword,
} = require("../controllers/auth.controller");

router.post("/login", login);
router.get("/me", auth, getMe);
router.put("/profile", auth, updateProfile);
router.put("/password", auth, changePassword);

module.exports = router;
