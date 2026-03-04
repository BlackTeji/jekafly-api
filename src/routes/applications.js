const router = require('express').Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/applications');

router.post('/',              authenticate,  ctrl.create);
router.get('/',               authenticate,  ctrl.list);
router.get('/track/:ref',     optionalAuth,  ctrl.track);  // public
router.get('/:ref',           authenticate,  ctrl.getOne);

module.exports = router;
