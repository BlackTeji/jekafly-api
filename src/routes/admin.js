const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/admin');
const affiliateCtrl = require('../controllers/affiliates');

router.use(authenticate, requireAdmin);

// ─── Applications ─────────────────────────────────────────────────────────────
router.get('/applications',             ctrl.listApplications);
router.get('/applications/:ref',        ctrl.getApplication);
router.patch('/applications/:ref/status', ctrl.updateStatus);

// ─── Users ────────────────────────────────────────────────────────────────────
router.get('/users',                    ctrl.listUsers);
router.patch('/users/:id/role',         ctrl.updateRole);
router.patch('/users/:id/admin-role',   ctrl.updateAdminRole);
router.delete('/users/:id',             ctrl.deleteUser);

// ─── Documents ────────────────────────────────────────────────────────────────
router.get('/documents/zip',            ctrl.downloadDocumentsZip);
router.get('/documents/:id/stream',     ctrl.streamDocument);
router.get('/documents',                ctrl.listDocuments);

// ─── Payments ────────────────────────────────────────────────────────────────
router.get('/payments',                 ctrl.getAllPayments);

// ─── Affiliates ───────────────────────────────────────────────────────────────
router.get('/affiliates',                         affiliateCtrl.adminList);
router.patch('/affiliates/:id/status',            affiliateCtrl.adminUpdateStatus);
router.patch('/affiliates/payouts/:payoutId/process', affiliateCtrl.adminProcessPayout);

// ─── Flights & Hotels ─────────────────────────────────────────────────────────
router.get('/flights',                  ctrl.listFlightBookings);
router.get('/hotels',                   ctrl.listHotelBookings);

module.exports = router;