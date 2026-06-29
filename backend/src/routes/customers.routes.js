const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const c = require('../controllers/customers.controller');

router.use(auth);

router.get('/', c.list);
router.post('/', c.create);
router.get('/:id', c.get);
router.put('/:id', c.update);
router.delete('/:id', c['delete']);

router.get('/:id/locations', c.getLocations);
router.post('/:id/locations', c.createLocation);

router.get('/:id/contacts', c.getContacts);
router.post('/:id/contacts', c.createContact);

module.exports = router;
