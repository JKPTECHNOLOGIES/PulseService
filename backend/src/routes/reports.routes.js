const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const { revenue, jobs, technicians, customers } = require('../controllers/reports.controller');

router.use(auth);

router.get('/revenue', revenue);
router.get('/jobs', jobs);
router.get('/technicians', technicians);
router.get('/customers', customers);

module.exports = router;
