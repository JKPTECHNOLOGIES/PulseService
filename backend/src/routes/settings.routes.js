const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const c = require('../controllers/settings.controller');

router.use(auth);

// Business units (must come before '/' to avoid conflicts)
router.get('/business-units', c.getBusinessUnits);
router.post('/business-units', c.createBusinessUnit);
router.put('/business-units/:id', c.updateBusinessUnit);
router.delete('/business-units/:id', c.deleteBusinessUnit);

// Company settings
router.get('/', c.get);
router.put('/', c.update);

module.exports = router;
