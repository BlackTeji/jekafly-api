const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/admin');

// All admin routes require authentication + admin role
router.use(authenticate, requireAdmin);

router.get('/applications',              ctrl.listApplications);
router.patch('/applications/:ref/status', ctrl.updateStatus);
router.get('/users',                     ctrl.listUsers);
router.patch('/users/:id/role',          ctrl.updateRole);

module.exports = router;
