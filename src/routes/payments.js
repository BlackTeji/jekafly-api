const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/payments');

// Webhook uses raw body — must be mounted before json() middleware (handled in index.js)
router.post('/webhook',           ctrl.webhook);          // public — Paystack calls this
router.post('/initiate',          authenticate, ctrl.initiate);
router.get('/:reference/verify',  authenticate, ctrl.verify);
router.get('/',                   authenticate, ctrl.list);

module.exports = router;
