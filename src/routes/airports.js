// ─── src/routes/airports.js ───────────────────────────────────────────────────
'use strict';
const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/airports');

router.get('/',              ctrl.list);                           // public — flights page
router.get('/admin',         authenticate, requireAdmin, ctrl.adminList);
router.post('/admin',        authenticate, requireAdmin, ctrl.create);
router.patch('/admin/:id',   authenticate, requireAdmin, ctrl.update);
router.delete('/admin/:id',  authenticate, requireAdmin, ctrl.remove);

module.exports = router;


// ─── src/routes/flights_admin.js ─────────────────────────────────────────────
// (save as a separate file: src/routes/flights_admin.js)
// 'use strict';
// const router = require('express').Router();
// const { authenticate, requireAdmin } = require('../middleware/auth');
// const ctrl = require('../controllers/flights_admin');
//
// // Analytics
// router.get('/analytics',                       authenticate, requireAdmin, ctrl.analytics);
// // Flight templates
// router.get('/',                                authenticate, requireAdmin, ctrl.listFlights);
// router.post('/',                               authenticate, requireAdmin, ctrl.createFlight);
// router.patch('/:id',                           authenticate, requireAdmin, ctrl.updateFlight);
// router.delete('/:id',                          authenticate, requireAdmin, ctrl.deleteFlight);
// router.post('/:id/schedule',                   authenticate, requireAdmin, ctrl.bulkSchedule);
// // Instances
// router.get('/instances',                       authenticate, requireAdmin, ctrl.listInstances);
// router.patch('/instances/:id',                 authenticate, requireAdmin, ctrl.updateInstance);
// // Bookings
// router.get('/bookings',                        authenticate, requireAdmin, ctrl.listBookings);
// router.patch('/bookings/:id',                  authenticate, requireAdmin, ctrl.updateBooking);
//
// module.exports = router;