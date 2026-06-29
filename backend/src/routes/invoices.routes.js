const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const c = require('../controllers/invoices.controller');

router.use(auth);

router.get('/', c.list);
router.post('/', c.create);
router.get('/:id', c.get);
router.put('/:id', c.update);

router.post('/:id/send', c.send);
router.post('/:id/payment', c.recordPayment);
router.post('/:id/void', c['void']);

module.exports = router;
