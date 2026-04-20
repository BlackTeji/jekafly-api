'use strict';
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const sse = require('../services/sse');

router.get('/', authenticate, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const userId = req.user.id;
    sse.addClient(userId, res);

    res.write(`event: connected\ndata: ${JSON.stringify({ userId, ts: Date.now() })}\n\n`);

    const heartbeat = setInterval(() => {
        try { res.write(': heartbeat\n\n'); } catch (e) { clearInterval(heartbeat); }
    }, 25000);

    req.on('close', () => {
        clearInterval(heartbeat);
        sse.removeClient(userId, res);
    });
});

module.exports = router;