const router = require('express').Router();
const { rateLimit } = require('express-rate-limit');
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/admin');
const bankVerify = require('../controllers/bankVerify');
const affiliateCtrl = require('../controllers/affiliates');
const analyticsCtrl = require('../controllers/analytics');
const pageviewsCtrl = require('../controllers/pageviews');

const bankVerifyLimit = rateLimit({
    windowMs: 60 * 1000, max: 15,
    message: { ok: false, error: 'Too many verification attempts. Please wait a moment.' },
    standardHeaders: true, legacyHeaders: false,
});

router.use(authenticate, requireAdmin);

// ─── Applications ─────────────────────────────────────────────────────────────
router.get('/applications', ctrl.listApplications);
router.get('/applications/:ref', ctrl.getApplication);
router.patch('/applications/:ref/status', ctrl.updateStatus);

// ─── Users ────────────────────────────────────────────────────────────────────
router.get('/users', ctrl.listUsers);
router.patch('/users/:id/role', ctrl.updateRole);
router.patch('/users/:id/admin-role', ctrl.updateAdminRole);
router.delete('/users/:id', ctrl.deleteUser);

// ─── Documents ────────────────────────────────────────────────────────────────
router.get('/documents/zip', ctrl.downloadDocumentsZip);
router.get('/documents/:id/stream', ctrl.streamDocument);
router.get('/documents', ctrl.listDocuments);

// ─── Payments ────────────────────────────────────────────────────────────────
router.get('/payments', ctrl.getAllPayments);

// ─── Analytics & Pageviews ────────────────────────────────────────────────────
router.get('/analytics', analyticsCtrl.getDashboard);
router.get('/pageviews', pageviewsCtrl.getPageviews);

// ─── Affiliates ───────────────────────────────────────────────────────────────
router.get('/affiliates', affiliateCtrl.adminList);
router.get('/affiliates/payouts', affiliateCtrl.adminGetAllPayouts);
router.patch('/affiliates/payouts/:payoutId/process', affiliateCtrl.adminProcessPayout);
router.patch('/affiliates/:id/status', affiliateCtrl.adminUpdateStatus);

// ─── Flights & Hotels ─────────────────────────────────────────────────────────
router.get('/verify-bank', bankVerifyLimit, bankVerify.verifyBankAccount);
router.get('/flights', ctrl.listFlightBookings);
router.get('/hotels', ctrl.listHotelBookings);

module.exports = router;