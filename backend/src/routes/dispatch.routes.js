const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const { getBoard, reassign } = require('../controllers/dispatch.controller');

router.use(auth);

router.get('/board', getBoard);
router.post('/reassign', reassign);

module.exports = router;
