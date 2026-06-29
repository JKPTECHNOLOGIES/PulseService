const router = require('express').Router();
const auth = require('../middleware/auth.middleware');
const c = require('../controllers/pricebook.controller');

router.use(auth);

// Categories
router.get('/categories', c.listCategories);
router.post('/categories', c.createCategory);
router.put('/categories/:id', c.updateCategory);
router.delete('/categories/:id', c.deleteCategory);

// Items
router.get('/items', c.listItems);
router.post('/items', c.createItem);
router.put('/items/:id', c.updateItem);
router.delete('/items/:id', c.deleteItem);

module.exports = router;
