const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const { list, markRead } = require('../controllers/notifications.controller');

router.use(auth);

router.get('/', list);
router.post('/mark-read', markRead);

module.exports = router;
