const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { getStatus, join, getPerks } = require('../controllers/club');

router.get('/perks', getPerks);
router.get('/status', auth, getStatus);
router.post('/join', auth, join);

module.exports = router;