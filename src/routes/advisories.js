const router = require('express').Router();
const advisories = require('../services/advisories');

// GET /advisories/:country — live US State Dept + UK FCDO advice (public, cached)
router.get('/:country', async (req, res) => {
    try {
        const country = String(req.params.country || '').trim().slice(0, 80);
        if (!country) return res.status(400).json({ ok: false, error: 'Country is required.' });
        const data = await advisories.getAdvisory(country);
        res.set('Cache-Control', 'public, max-age=900');
        res.json({ ok: true, data });
    } catch (err) {
        console.error('[Advisories] route error:', err.message);
        res.status(502).json({ ok: false, error: 'Travel advisories are temporarily unavailable.' });
    }
});

module.exports = router;
