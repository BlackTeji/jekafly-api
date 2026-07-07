const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

const REGION_ORDER = [
    'Southwest',
    'South-South',
    'Southeast',
    'North-Central',
    'Northwest',
    'Northeast',
];

async function listHolidays(req, res) {
    try {
        const { region, tier } = req.query;
        const where = { status: 'ACTIVE' };
        if (region) where.region = region;
        if (tier) where.tier = tier.toUpperCase();

        const holidays = await db.holiday.findMany({
            where,
            include: {
                dates: {
                    where: { date: { gte: new Date() } },
                    orderBy: { date: 'asc' },
                },
            },
            orderBy: [{ region: 'asc' }, { packageName: 'asc' }],
        });

        const withAvailability = holidays.map(h => {
            const openDates = h.dates.filter(d => d.bookedCount < d.capacity);
            return {
                ...h,
                hasAvailability: openDates.length > 0,
                dates: openDates.slice(0, 3),
            };
        });

        const grouped = {};
        for (const h of withAvailability) {
            if (!grouped[h.region]) grouped[h.region] = [];
            grouped[h.region].push(h);
        }

        const ordered = REGION_ORDER.filter(r => grouped[r]).map(r => ({
            region: r,
            packages: grouped[r],
        }));

        return res.json({ ok: true, data: { regions: ordered } });
    } catch (err) {
        console.error('listHolidays error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to load holidays' });
    }
}

async function getHoliday(req, res) {
    try {
        const holiday = await db.holiday.findUnique({
            where: { id: req.params.id },
        });

        if (!holiday) return res.status(404).json({ ok: false, error: 'Package not found' });

        const dates = await db.holidayDate.findMany({
            where: {
                holidayId: holiday.id,
                date: { gte: new Date() },
            },
            orderBy: { date: 'asc' },
        });

        const availableDates = dates.map(d => ({
            ...d,
            available: d.capacity - d.bookedCount,
            isFull: d.bookedCount >= d.capacity,
        }));

        const hasAvailability = availableDates.some(d => !d.isFull);

        return res.json({ ok: true, data: { holiday: { ...holiday, availableDates, hasAvailability } } });
    } catch (err) {
        console.error('getHoliday error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to load package' });
    }
}

async function getAvailability(req, res) {
    try {
        const dates = await db.holidayDate.findMany({
            where: {
                holidayId: req.params.id,
                date: { gte: new Date() },
            },
            orderBy: { date: 'asc' },
        });

        const result = dates.map(d => ({
            id: d.id,
            date: d.date,
            capacity: d.capacity,
            bookedCount: d.bookedCount,
            available: d.capacity - d.bookedCount,
            isFull: d.bookedCount >= d.capacity,
        }));

        return res.json({ ok: true, data: { dates: result } });
    } catch (err) {
        console.error('getAvailability error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to load availability' });
    }
}

async function createBooking(req, res) {
    try {
        const {
            holidayId,
            holidayDateId,
            tier,
            travellers,
            leadName,
            leadEmail,
            leadPhone,
            addMembership,
            additionalTravellers,
        } = req.body;

        const userId = req.user.id;

        if (!holidayId || !holidayDateId || !tier || !travellers || !leadName || !leadEmail) {
            return res.status(400).json({ ok: false, error: 'Missing required fields' });
        }

        const rawAdditional = Array.isArray(additionalTravellers) ? additionalTravellers : [];
        const sanitizedTravellers = rawAdditional
            .map(t => ({
                name: String(t?.name || '').trim().slice(0, 120),
                phone: String(t?.phone || '').trim().slice(0, 30) || null,
            }))
            .filter(t => t.name);

        if (sanitizedTravellers.length !== travellers - 1) {
            return res.status(400).json({ ok: false, error: 'Please provide a full name for every additional traveller' });
        }

        const validTiers = ['EXPLORER', 'SIGNATURE', 'EXECUTIVE'];
        if (!validTiers.includes(tier.toUpperCase())) {
            return res.status(400).json({ ok: false, error: 'Invalid tier' });
        }

        const holiday = await db.holiday.findUnique({ where: { id: holidayId } });
        if (!holiday || holiday.status !== 'ACTIVE') {
            return res.status(404).json({ ok: false, error: 'Package not found' });
        }

        const slot = await db.holidayDate.findUnique({ where: { id: holidayDateId } });
        if (!slot || slot.holidayId !== holidayId) {
            return res.status(404).json({ ok: false, error: 'Date not found' });
        }
        if (slot.bookedCount + travellers > slot.capacity) {
            return res.status(400).json({ ok: false, error: 'Not enough availability for this date' });
        }

        const tierKey = `price${tier.charAt(0) + tier.slice(1).toLowerCase()}`;
        const tierPrice = holiday[tierKey];
        if (!tierPrice) {
            return res.status(400).json({ ok: false, error: 'This tier is not available for this package' });
        }

        const tierAmount = tierPrice * travellers;

        let membershipAmount = 0;
        let membershipAdded = false;

        if (addMembership) {
            const existing = await db.clubMembership.findUnique({ where: { userId } });
            const isActive = existing && existing.status === 'ACTIVE' && existing.expiryDate > new Date();

            if (!isActive) {
                const pricing = await db.pricingConfig.findUnique({ where: { id: 'singleton' } });
                membershipAmount = pricing?.clubMembershipFee || 150000;
                membershipAdded = true;
            }
        }

        const totalAmount = tierAmount + membershipAmount;

        const ref = `JKF-HOL-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

        const booking = await db.holidayBooking.create({
            data: {
                ref,
                userId,
                holidayId,
                holidayDateId,
                tier: tier.toUpperCase(),
                travellers,
                leadName,
                leadEmail,
                leadPhone,
                additionalTravellers: sanitizedTravellers,
                tierAmount,
                membershipAdded,
                membershipAmount,
                totalAmount,
                status: 'PENDING',
            },
        });

        return res.status(201).json({
            ok: true,
            data: {
                booking: {
                    id: booking.id,
                    ref: booking.ref,
                    totalAmount,
                    tierAmount,
                    membershipAdded,
                    membershipAmount,
                },
            },
        });
    } catch (err) {
        console.error('createBooking error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to create booking' });
    }
}

async function myBookings(req, res) {
    try {
        const bookings = await db.holidayBooking.findMany({
            where: { userId: req.user.id },
            include: {
                holiday: {
                    select: {
                        packageName: true,
                        state: true,
                        region: true,
                        tier: true,
                        durationDays: true,
                        durationNights: true,
                        images: true,
                    },
                },
                holidayDate: {
                    select: { date: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        return res.json({ ok: true, data: { bookings } });
    } catch (err) {
        console.error('myBookings error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to load bookings' });
    }
}

async function adminListPackages(req, res) {
    try {
        const holidays = await db.holiday.findMany({
            include: { dates: { orderBy: { date: 'asc' } } },
            orderBy: [{ region: 'asc' }, { packageName: 'asc' }],
        });
        return res.json({ ok: true, data: { holidays } });
    } catch (err) {
        console.error('adminListPackages error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to load packages' });
    }
}

async function adminCreateDate(req, res) {
    try {
        const { date, endDate, capacity } = req.body;
        if (!date) return res.status(400).json({ ok: false, error: 'Date is required' });

        const holiday = await db.holiday.findUnique({ where: { id: req.params.holidayId } });
        if (!holiday) return res.status(404).json({ ok: false, error: 'Package not found' });

        const created = await db.holidayDate.create({
            data: {
                holidayId: req.params.holidayId,
                date: new Date(date),
                endDate: endDate ? new Date(endDate) : null,
                capacity: capacity != null ? parseInt(capacity) : 20,
            },
        });
        return res.status(201).json({ ok: true, data: { date: created } });
    } catch (err) {
        console.error('adminCreateDate error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to create date' });
    }
}

async function adminUpdateDate(req, res) {
    try {
        const { date, endDate, capacity } = req.body;
        const updated = await db.holidayDate.update({
            where: { id: req.params.dateId },
            data: {
                ...(date && { date: new Date(date) }),
                ...(endDate !== undefined && { endDate: endDate ? new Date(endDate) : null }),
                ...(capacity != null && { capacity: parseInt(capacity) }),
            },
        });
        return res.json({ ok: true, data: { date: updated } });
    } catch (err) {
        console.error('adminUpdateDate error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to update date' });
    }
}

async function adminDeleteDate(req, res) {
    try {
        const existing = await db.holidayDate.findUnique({
            where: { id: req.params.dateId },
            include: { bookings: true },
        });
        if (!existing) return res.status(404).json({ ok: false, error: 'Date not found' });
        if (existing.bookings.length > 0) {
            return res.status(400).json({ ok: false, error: 'Cannot delete a date with existing bookings' });
        }
        await db.holidayDate.delete({ where: { id: req.params.dateId } });
        return res.json({ ok: true });
    } catch (err) {
        console.error('adminDeleteDate error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to delete date' });
    }
}

async function adminListBookings(req, res) {
    try {
        const { status, holidayId, search } = req.query;
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 20));

        const where = {};
        if (status && status !== 'all') where.status = status.toUpperCase();
        if (holidayId) where.holidayId = holidayId;
        if (search) {
            where.OR = [
                { ref: { contains: search, mode: 'insensitive' } },
                { leadName: { contains: search, mode: 'insensitive' } },
                { leadEmail: { contains: search, mode: 'insensitive' } },
                { leadPhone: { contains: search, mode: 'insensitive' } },
            ];
        }

        const [total, bookings] = await Promise.all([
            db.holidayBooking.count({ where }),
            db.holidayBooking.findMany({
                where,
                include: {
                    holiday: { select: { packageName: true, state: true, region: true } },
                    holidayDate: { select: { date: true, endDate: true } },
                    user: { select: { id: true, name: true, email: true, phone: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
        ]);

        return res.json({
            ok: true,
            data: { bookings, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
        });
    } catch (err) {
        console.error('adminListBookings error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to load bookings' });
    }
}

async function adminUpdateBookingStatus(req, res) {
    try {
        const { status } = req.body;
        const validStatuses = ['PENDING', 'CONFIRMED', 'CANCELLED'];
        if (!status || !validStatuses.includes(status.toUpperCase())) {
            return res.status(400).json({ ok: false, error: 'Invalid status' });
        }
        const newStatus = status.toUpperCase();

        const booking = await db.holidayBooking.findUnique({ where: { id: req.params.id } });
        if (!booking) return res.status(404).json({ ok: false, error: 'Booking not found' });
        if (booking.status === newStatus) {
            return res.json({ ok: true, data: { booking } });
        }

        const result = await db.$transaction(async (tx) => {
            // Cancelling a previously-confirmed booking releases its claimed capacity.
            if (booking.status === 'CONFIRMED' && newStatus === 'CANCELLED') {
                await tx.holidayDate.update({
                    where: { id: booking.holidayDateId },
                    data: { bookedCount: { decrement: booking.travellers } },
                });
            }
            // Reconfirming re-claims capacity — but only if there's still room.
            if (booking.status !== 'CONFIRMED' && newStatus === 'CONFIRMED') {
                const slot = await tx.holidayDate.findUnique({ where: { id: booking.holidayDateId } });
                if (!slot || slot.bookedCount + booking.travellers > slot.capacity) {
                    throw new Error('CAPACITY_UNAVAILABLE');
                }
                await tx.holidayDate.update({
                    where: { id: booking.holidayDateId },
                    data: { bookedCount: { increment: booking.travellers } },
                });
            }

            return tx.holidayBooking.update({
                where: { id: booking.id },
                data: { status: newStatus },
            });
        });

        return res.json({ ok: true, data: { booking: result } });
    } catch (err) {
        if (err.message === 'CAPACITY_UNAVAILABLE') {
            return res.status(400).json({ ok: false, error: 'Not enough capacity left on this date to reconfirm this booking' });
        }
        console.error('adminUpdateBookingStatus error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to update booking' });
    }
}

async function adminUpdateHoliday(req, res) {
    try {
        const { priceExplorer, priceSignature, priceExecutive, status } = req.body;

        const holiday = await db.holiday.findUnique({ where: { id: req.params.id } });
        if (!holiday) return res.status(404).json({ ok: false, error: 'Package not found' });

        const data = {};
        for (const [key, val] of [['priceExplorer', priceExplorer], ['priceSignature', priceSignature], ['priceExecutive', priceExecutive]]) {
            if (val === undefined) continue;
            if (val === null || val === '') { data[key] = null; continue; }
            const n = parseInt(val, 10);
            if (isNaN(n) || n < 0) {
                return res.status(400).json({ ok: false, error: `Invalid value for ${key}` });
            }
            data[key] = n;
        }

        if (status !== undefined) {
            const validStatuses = ['ACTIVE', 'DRAFT', 'ARCHIVED'];
            if (!validStatuses.includes(status.toUpperCase())) {
                return res.status(400).json({ ok: false, error: 'Invalid status' });
            }
            data.status = status.toUpperCase();
        }

        const updated = await db.holiday.update({
            where: { id: req.params.id },
            data,
        });

        return res.json({ ok: true, data: { holiday: updated } });
    } catch (err) {
        console.error('adminUpdateHoliday error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to update package' });
    }
}

module.exports = {
    listHolidays, getHoliday, getAvailability, createBooking, myBookings,
    adminListPackages, adminCreateDate, adminUpdateDate, adminDeleteDate,
    adminListBookings, adminUpdateBookingStatus, adminUpdateHoliday,
};