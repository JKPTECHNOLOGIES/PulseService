const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const { list, get, create, update, scheduleVisit, completeVisit } = require('../controllers/agreements.controller');

router.use(auth);

router.get('/', list);
router.post('/', create);
router.get('/:id', get);
router.put('/:id', update);

router.post('/:id/visits', scheduleVisit);
router.put('/:id/visits/:visitId/complete', completeVisit);

module.exports = router;
