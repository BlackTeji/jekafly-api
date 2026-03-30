const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/admin');

router.use(authenticate, requireAdmin);

router.get('/applications', ctrl.listApplications);
router.get('/applications/:ref', ctrl.getApplication);
router.patch('/applications/:ref/status', ctrl.updateStatus);
router.get('/users', ctrl.listUsers);
router.patch('/users/:id/role', ctrl.updateRole);
router.delete('/users/:id', ctrl.deleteUser);
router.get('/documents/zip', ctrl.downloadDocumentsZip);
router.get('/documents/:id/stream', ctrl.streamDocument);
router.get('/documents', ctrl.listDocuments);
router.patch('/users/:id/admin-role', ctrl.updateAdminRole);

const affiliateCtrl = require('../controllers/affiliates');
router.get('/affiliates', affiliateCtrl.adminList);
router.patch('/affiliates/:id/status', affiliateCtrl.adminUpdateStatus);
router.patch('/affiliates/payouts/:payoutId/process', affiliateCtrl.adminProcessPayout);

router.get('/flight-bookings', ctrl.listFlightBookings);
router.get('/hotel-bookings', ctrl.listHotelBookings);

module.exports = router;