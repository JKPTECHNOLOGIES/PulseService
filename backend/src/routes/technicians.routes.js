const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const { list, get, updateLocation, getAvailability } = require('../controllers/technicians.controller');

router.use(auth);

router.get('/', list);
router.get('/:id', get);
router.patch('/:id/location', updateLocation);
router.get('/:id/availability', getAvailability);

module.exports = router;
