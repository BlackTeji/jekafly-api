const router = require('express').Router();
const { authenticate } = require('../middleware/auth');

// ── GET /hotels ────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res, next) => {
    try {
        res.json({ ok: true, data: { bookings: [], total: 0 } });
    } catch (err) { next(err); }
});

module.exports = router;