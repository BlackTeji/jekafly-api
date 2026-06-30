const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const {
    listHolidays,
    getHoliday,
    getAvailability,
    createBooking,
    myBookings,
} = require('../controllers/holidays');

router.get('/', listHolidays);
router.get('/my-bookings', authenticate, myBookings);
router.get('/:id', getHoliday);
router.get('/:id/availability', getAvailability);
router.post('/book', authenticate, createBooking);

module.exports = router;
