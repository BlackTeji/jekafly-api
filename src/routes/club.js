const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { getStatus, join, getPerks } = require('../controllers/club');

router.get('/perks', getPerks);
router.get('/status', authenticate, getStatus);
router.post('/join', authenticate, join);

module.exports = router;
