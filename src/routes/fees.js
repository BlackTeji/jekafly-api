const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/fees');

router.get('/', ctrl.getAll);          // public
router.put('/service', authenticate, requireAdmin, ctrl.setServiceFee);
router.patch('/:country/toggle', authenticate, requireAdmin, ctrl.toggleCountry);
router.put('/:country', authenticate, requireAdmin, ctrl.setDestinationFee);
router.delete('/:country', authenticate, requireAdmin, ctrl.resetDestinationFee);

module.exports = router;