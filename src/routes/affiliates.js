const router = require('express').Router();
const { authenticate, requireAdmin, optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/affiliates');

// ── Public / user routes ───────────────────────────────────────────────────────
router.post('/apply', optionalAuth, ctrl.apply);

router.get('/me', authenticate, ctrl.getMe);
router.get('/stats', authenticate, ctrl.getStats);
router.get('/payouts', authenticate, ctrl.getPayouts);
router.post('/payouts/request', authenticate, ctrl.requestPayout);

module.exports = router;