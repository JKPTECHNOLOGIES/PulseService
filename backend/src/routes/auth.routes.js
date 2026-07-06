const router = require("express").Router();
const auth = require("../middleware/auth.middleware");
const rateLimit = require("../middleware/rateLimit.middleware");
const {
  login,
  getMe,
  updateProfile,
  changePassword,
} = require("../controllers/auth.controller");

// Throttle credential endpoints to blunt brute-force / credential-stuffing.
// Escape hatch for local dev/testing (e.g. repeatedly re-seeding and logging
// back in): set DISABLE_LOGIN_RATE_LIMIT=true in the environment to bypass
// it entirely. Defaults to enforced -- this must never be set in production.
const loginLimiter =
  process.env.DISABLE_LOGIN_RATE_LIMIT === "true"
    ? (req, res, next) => {
        next();
      }
    : rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 10,
        message: "Too many login attempts. Please try again in a few minutes.",
      });
const passwordLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

router.post("/login", loginLimiter, login);
router.get("/me", auth, getMe);
router.put("/profile", auth, updateProfile);
router.put("/password", auth, passwordLimiter, changePassword);

module.exports = router;
