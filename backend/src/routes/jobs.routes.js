const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const c = require('../controllers/jobs.controller');

router.use(auth);

router.get('/', c.list);
router.post('/', c.create);
router.get('/:id', c.get);
router.put('/:id', c.update);
router.patch('/:id/status', c.updateStatus);

router.post('/:id/technicians', c.assignTechnician);
router.delete('/:id/technicians/:techId', c.removeTechnician);

module.exports = router;
