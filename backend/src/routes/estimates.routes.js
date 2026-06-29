const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const c = require('../controllers/estimates.controller');

router.use(auth);

router.get('/', c.list);
router.post('/', c.create);
router.get('/:id', c.get);
router.put('/:id', c.update);

router.post('/:id/send', c.send);
router.post('/:id/approve', c.approve);
router.post('/:id/reject', c.reject);
router.post('/:id/convert', c.convertToInvoice);

module.exports = router;
