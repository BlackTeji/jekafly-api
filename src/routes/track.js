'use strict';
const router = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const { optionalAuth } = require('../middleware/auth');
const ctrl = require('../controllers/pageviews');

const trackLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false },
});

router.post('/', trackLimit, optionalAuth, ctrl.track);

module.exports = router;