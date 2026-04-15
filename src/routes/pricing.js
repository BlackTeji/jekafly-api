const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/pricing');

router.get('/', ctrl.get);
router.patch('/', authenticate, requireAdmin, ctrl.update);

module.exports = router;