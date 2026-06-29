const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const c = require('../controllers/campaigns.controller');

router.use(auth);

router.get('/', c.list);
router.post('/', c.create);
router.put('/:id', c.update);
router.delete('/:id', c['delete']);

module.exports = router;
