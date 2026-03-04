const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/visa');

router.get('/',          ctrl.getAll);   // public
router.put('/:country',  authenticate, requireAdmin, ctrl.update);

module.exports = router;
