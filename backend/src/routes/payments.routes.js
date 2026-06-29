const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const { list } = require('../controllers/payments.controller');

router.use(auth);

router.get('/', list);

module.exports = router;
