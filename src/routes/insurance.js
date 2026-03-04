const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/insurance');

router.get('/',     authenticate, ctrl.list);
router.get('/:id',  authenticate, ctrl.getOne);
// POST /insurance is called internally by the payments webhook — not exposed directly

module.exports = router;
