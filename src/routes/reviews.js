const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/reviews');

router.get('/', ctrl.listApproved);
router.get('/survey/:token', ctrl.getSurvey);
router.post('/survey/:token', ctrl.submitSurvey);

router.get('/admin', authenticate, requireAdmin, ctrl.adminList);
router.patch('/admin/:id', authenticate, requireAdmin, ctrl.adminUpdate);
router.delete('/admin/:id', authenticate, requireAdmin, ctrl.adminDelete);

module.exports = router;