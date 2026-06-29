const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const { list, get, create, update } = require('../controllers/calls.controller');

router.use(auth);

router.get('/', list);
router.post('/', create);
router.get('/:id', get);
router.put('/:id', update);

module.exports = router;
