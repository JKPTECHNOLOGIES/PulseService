const router = require("express").Router();
const multer = require("multer");
const auth = require("../middleware/auth.middleware");
const c = require("../controllers/attachments.controller");

// Keep uploads in memory; the buffer is written straight into Postgres (bytea).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB per file
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
});

// Multer errors (e.g. file too large / wrong type) should surface as clean 400s
// rather than bubbling into the generic 500 handler.
const uploadSingle = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ success: false, error: err.message });
    }
    next();
  });
};

router.use(auth);

router.get("/", c.list);
router.post("/", uploadSingle, c.create);
router.get("/:id/raw", c.getRaw);
router.delete("/:id", c.remove);

module.exports = router;
