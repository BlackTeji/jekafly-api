const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/pricing');

router.get('/', ctrl.get);
router.patch('/', authenticate, ctrl.update);

module.exports = router;