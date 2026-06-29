const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const { login, getMe, updateProfile } = require('../controllers/auth.controller');

router.post('/login', login);
router.get('/me', auth, getMe);
router.put('/profile', auth, updateProfile);

module.exports = router;
