const router = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const bankVerify = require('../controllers/bankVerify');

const bankVerifyLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    message: { ok: false, error: 'Too many verification attempts. Please wait a moment.' },
    standardHeaders: true,
    legacyHeaders: false,
});

router.get('/resolve', bankVerifyLimit, bankVerify.verifyBankAccount);

module.exports = router;