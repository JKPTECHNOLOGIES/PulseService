const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const { list, get, adjust, receive, getTransactions } = require('../controllers/inventory.controller');

router.use(auth);

router.get('/', list);
router.get('/:id', get);
router.post('/:id/adjust', adjust);
router.post('/:id/receive', receive);
router.get('/:id/transactions', getTransactions);

module.exports = router;
