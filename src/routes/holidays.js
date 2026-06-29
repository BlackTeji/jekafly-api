const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const {
    listHolidays,
    getHoliday,
    getAvailability,
    createBooking,
    myBookings,
} = require('../controllers/holidays');

router.get('/', listHolidays);
router.get('/my-bookings', auth, myBookings);
router.get('/:id', getHoliday);
router.get('/:id/availability', getAvailability);
router.post('/book', auth, createBooking);

module.exports = router;