const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/auth');

router.post('/register',              ctrl.register);
router.post('/login',                 ctrl.login);
router.post('/refresh',               ctrl.refresh);
router.post('/forgot-password',       ctrl.forgotPassword);
router.post('/reset-password',        ctrl.resetPassword);

router.post('/logout',                authenticate, ctrl.logout);
router.get('/me',                     authenticate, ctrl.me);
router.patch('/me',                   authenticate, ctrl.updateMe);
router.post('/change-password',       authenticate, ctrl.changePassword);
router.post('/request-password-otp',  authenticate, ctrl.requestPasswordOtp);
router.delete('/me',                  authenticate, ctrl.deleteAccount);

module.exports = router;