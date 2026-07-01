const express = require('express');
const router = express.Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const {
    listHolidays,
    getHoliday,
    getAvailability,
    createBooking,
    myBookings,
    adminListPackages,
    adminCreateDate,
    adminUpdateDate,
    adminDeleteDate,
} = require('../controllers/holidays');

router.get('/', listHolidays);
router.get('/my-bookings', authenticate, myBookings);
router.get('/admin/packages', authenticate, requireAdmin, adminListPackages);
router.post('/admin/:holidayId/dates', authenticate, requireAdmin, adminCreateDate);
router.patch('/admin/dates/:dateId', authenticate, requireAdmin, adminUpdateDate);
router.delete('/admin/dates/:dateId', authenticate, requireAdmin, adminDeleteDate);
router.get('/:id', getHoliday);
router.get('/:id/availability', getAvailability);
router.post('/book', authenticate, createBooking);

module.exports = router;