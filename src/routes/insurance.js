const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/insurance');

router.get('/', authenticate, ctrl.list);
router.get('/:id/receipt', authenticate, ctrl.getReceipt);
router.get('/:id', authenticate, ctrl.getOne);

module.exports = router;
