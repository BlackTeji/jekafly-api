'use strict';
const prisma = require('../utils/prisma');

// ════════════════════════════════════════════════════════════════
// FLIGHT TEMPLATES
// ════════════════════════════════════════════════════════════════

// GET /admin/flights
exports.listFlights = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || '1'));
    const limit = Math.min(50, parseInt(req.query.limit || '20'));
    const q     = req.query.q?.trim();

    const where = q ? {
      OR: [
        { flightNumber: { contains: q, mode: 'insensitive' } },
        { airline:      { contains: q, mode: 'insensitive' } },
        { origin:      { city: { contains: q, mode: 'insensitive' } } },
        { destination: { city: { contains: q, mode: 'insensitive' } } },
      ],
    } : {};

    const [flights, total] = await Promise.all([
      prisma.flight.findMany({
        where,
        include: { origin: true, destination: true },
        orderBy: { flightNumber: 'asc' },
        skip:  (page - 1) * limit,
        take:  limit,
      }),
      prisma.flight.count({ where }),
    ]);
    res.json({ ok: true, data: { flights, total, page, pages: Math.ceil(total / limit) } });
  } catch (e) { next(e); }
};

// POST /admin/flights
exports.createFlight = async (req, res, next) => {
  try {
    const {
      flightNumber, airline, airlineLogo, originId, destId,
      departureTime, arrivalTime, arrivalOffset,
      terminal, gate, aircraft,
      economySeats, economyPrice, businessSeats, businessPrice, firstSeats, firstPrice,
    } = req.body;

    if (!flightNumber || !airline || !originId || !destId || !departureTime || !arrivalTime)
      return res.status(400).json({ ok: false, error: 'flightNumber, airline, originId, destId, departureTime and arrivalTime are required.' });

    const flight = await prisma.flight.create({
      data: {
        flightNumber: flightNumber.toUpperCase().trim(),
        airline, airlineLogo: airlineLogo || null,
        originId, destId,
        departureTime, arrivalTime,
        arrivalOffset: arrivalOffset || 0,
        terminal: terminal || null, gate: gate || null, aircraft: aircraft || null,
        economySeats:  parseInt(economySeats  || 150),
        economyPrice:  parseInt(economyPrice  || 0),
        businessSeats: parseInt(businessSeats || 30),
        businessPrice: parseInt(businessPrice || 0),
        firstSeats:    parseInt(firstSeats    || 0),
        firstPrice:    parseInt(firstPrice    || 0),
      },
      include: { origin: true, destination: true },
    });
    res.status(201).json({ ok: true, data: { flight } });
  } catch (e) { next(e); }
};

// PATCH /admin/flights/:id
exports.updateFlight = async (req, res, next) => {
  try {
    const allowed = [
      'flightNumber','airline','airlineLogo','originId','destId',
      'departureTime','arrivalTime','arrivalOffset','terminal','gate','aircraft',
      'economySeats','economyPrice','businessSeats','businessPrice','firstSeats','firstPrice','enabled',
    ];
    const data = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) data[k] = req.body[k]; });
    const flight = await prisma.flight.update({ where: { id: req.params.id }, data, include: { origin: true, destination: true } });
    res.json({ ok: true, data: { flight } });
  } catch (e) { next(e); }
};

// DELETE /admin/flights/:id
exports.deleteFlight = async (req, res, next) => {
  try {
    await prisma.flight.delete({ where: { id: req.params.id } });
    res.json({ ok: true, data: { message: 'Flight deleted.' } });
  } catch (e) { next(e); }
};

// ════════════════════════════════════════════════════════════════
// BULK SCHEDULE — generates FlightInstance records
// POST /admin/flights/:id/schedule
// Body: { startDate: "YYYY-MM-DD", endDate: "YYYY-MM-DD", frequency: "daily" | ["mon","wed","fri"] }
// ════════════════════════════════════════════════════════════════
const DAY_NAMES = ['sun','mon','tue','wed','thu','fri','sat'];

exports.bulkSchedule = async (req, res, next) => {
  try {
    const flight = await prisma.flight.findUnique({ where: { id: req.params.id } });
    if (!flight) return res.status(404).json({ ok: false, error: 'Flight not found.' });

    const { startDate, endDate, frequency } = req.body;
    if (!startDate || !endDate) return res.status(400).json({ ok: false, error: 'startDate and endDate are required.' });

    const start = new Date(startDate + 'T00:00:00Z');
    const end   = new Date(endDate   + 'T00:00:00Z');
    if (end < start) return res.status(400).json({ ok: false, error: 'endDate must be after startDate.' });

    // Build list of active days
    let activeDays = null; // null = every day
    if (frequency && frequency !== 'daily') {
      const days = Array.isArray(frequency) ? frequency : [frequency];
      activeDays = new Set(days.map(d => d.toLowerCase().slice(0,3)));
    }

    const toCreate = [];
    let cursor = new Date(start);
    let skipped = 0;

    while (cursor <= end) {
      const dayName = DAY_NAMES[cursor.getUTCDay()];
      if (!activeDays || activeDays.has(dayName)) {
        toCreate.push({
          flightId:      flight.id,
          date:          new Date(cursor),
          economyAvail:  flight.economySeats,
          businessAvail: flight.businessSeats,
          firstAvail:    flight.firstSeats,
        });
      } else {
        skipped++;
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    if (!toCreate.length) return res.status(400).json({ ok: false, error: 'No dates match the given frequency.' });

    // Upsert — skip dates that already have an instance
    const result = await prisma.flightInstance.createMany({ data: toCreate, skipDuplicates: true });

    res.status(201).json({
      ok: true,
      data: {
        created: result.count,
        skipped_days: skipped,
        message: `${result.count} flight instances created (${skipped} days skipped by frequency).`,
      },
    });
  } catch (e) { next(e); }
};

// ════════════════════════════════════════════════════════════════
// FLIGHT INSTANCES
// ════════════════════════════════════════════════════════════════

// GET /admin/flight-instances?flightId=&date=&status=&page=
exports.listInstances = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || '1'));
    const limit = Math.min(50, parseInt(req.query.limit || '20'));

    const where = {};
    if (req.query.flightId) where.flightId = req.query.flightId;
    if (req.query.status)   where.status   = req.query.status.toUpperCase();
    if (req.query.date) {
      const d = new Date(req.query.date + 'T00:00:00Z');
      where.date = { gte: d, lt: new Date(d.getTime() + 86400000) };
    }

    const [instances, total] = await Promise.all([
      prisma.flightInstance.findMany({
        where,
        include: { flight: { include: { origin: true, destination: true } } },
        orderBy: { date: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.flightInstance.count({ where }),
    ]);
    res.json({ ok: true, data: { instances, total, page, pages: Math.ceil(total / limit) } });
  } catch (e) { next(e); }
};

// PATCH /admin/flight-instances/:id — update status, cancel etc.
exports.updateInstance = async (req, res, next) => {
  try {
    const { status } = req.body;
    const instance = await prisma.flightInstance.update({
      where: { id: req.params.id },
      data: { ...(status && { status: status.toUpperCase() }) },
    });
    res.json({ ok: true, data: { instance } });
  } catch (e) { next(e); }
};

// ════════════════════════════════════════════════════════════════
// FLIGHT BOOKINGS (admin view)
// ════════════════════════════════════════════════════════════════

// GET /admin/flight-bookings?status=&paymentStatus=&q=&page=
exports.listBookings = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || '1'));
    const limit = Math.min(50, parseInt(req.query.limit || '20'));
    const q     = req.query.q?.trim();

    const where = {};
    if (req.query.status)        where.status        = req.query.status.toUpperCase();
    if (req.query.paymentStatus) where.paymentStatus = req.query.paymentStatus.toUpperCase();
    if (q) where.ref = { contains: q, mode: 'insensitive' };

    const [bookings, total] = await Promise.all([
      prisma.flightBooking.findMany({
        where,
        include: { instance: { include: { flight: { include: { origin: true, destination: true } } } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.flightBooking.count({ where }),
    ]);
    res.json({ ok: true, data: { bookings, total, page, pages: Math.ceil(total / limit) } });
  } catch (e) { next(e); }
};

// PATCH /admin/flight-bookings/:id — confirm / cancel / update payment
exports.updateBooking = async (req, res, next) => {
  try {
    const { status, paymentStatus } = req.body;
    const booking = await prisma.flightBooking.update({
      where: { id: req.params.id },
      data: {
        ...(status        && { status:        status.toUpperCase() }),
        ...(paymentStatus && { paymentStatus: paymentStatus.toUpperCase() }),
      },
    });
    res.json({ ok: true, data: { booking } });
  } catch (e) { next(e); }
};

// ════════════════════════════════════════════════════════════════
// DASHBOARD ANALYTICS
// GET /admin/flights/analytics
// ════════════════════════════════════════════════════════════════
exports.analytics = async (req, res, next) => {
  try {
    const todayStart = new Date(); todayStart.setUTCHours(0,0,0,0);
    const todayEnd   = new Date(); todayEnd.setUTCHours(23,59,59,999);

    const [activeToday, pendingPayments, totalBookings, totalFlights] = await Promise.all([
      prisma.flightInstance.count({
        where: { date: { gte: todayStart, lte: todayEnd }, status: { in: ['SCHEDULED','BOARDING','DEPARTED'] } },
      }),
      prisma.flightBooking.count({ where: { paymentStatus: 'INITIATED' } }),
      prisma.flightBooking.count(),
      prisma.flight.count({ where: { enabled: true } }),
    ]);

    res.json({ ok: true, data: { activeToday, pendingPayments, totalBookings, totalFlights } });
  } catch (e) { next(e); }
};