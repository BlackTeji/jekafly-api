const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();

const REGION_ORDER = [
    'Southwest',
    'South-South',
    'Southeast',
    'North-Central',
    'Northwest',
    'Northeast',
    'Passport Builder',
    'Squad Deals',
];

const CATEGORIES = ['LOCAL', 'INTERNATIONAL'];
const STATUSES = ['ACTIVE', 'DRAFT', 'ARCHIVED'];
const OCCUPANCIES = ['SINGLE', 'SHARING'];
const MAX_TRAVELLERS = 20;

function legacyTierPrice(h) {
    if (!h.tier) return null;
    const key = `price${h.tier.charAt(0) + h.tier.slice(1).toLowerCase()}`;
    return h[key] ?? null;
}

function standardPrice(h) {
    return h.price ?? legacyTierPrice(h);
}

function startingPrice(h) {
    if (h.category === 'INTERNATIONAL') {
        const opts = [h.priceSharing, h.priceSingle].filter(v => Number.isInteger(v) && v > 0);
        return opts.length ? Math.min(...opts) : null;
    }
    return standardPrice(h);
}

function unitPriceFor(h, occupancy) {
    if (h.category === 'INTERNATIONAL') {
        if (occupancy === 'SINGLE') return h.priceSingle ?? null;
        if (occupancy === 'SHARING') return h.priceSharing ?? null;
        return null;
    }
    return standardPrice(h);
}

function publicHoliday(h) {
    const { priceExplorer, priceSignature, priceExecutive, tier, ...rest } = h;
    return { ...rest, price: standardPrice(h), startingPrice: startingPrice(h) };
}

function toList(val) {
    if (Array.isArray(val)) return val.map(v => String(v).trim()).filter(Boolean);
    if (typeof val === 'string') return val.split(/\r?\n/).map(v => v.trim()).filter(Boolean);
    return [];
}

function toPrice(val, label) {
    if (val === null || val === '' || val === undefined) return null;
    const n = typeof val === 'number' ? val : parseInt(String(val).replace(/[^\d]/g, ''), 10);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`INVALID:${label} must be a whole naira amount above 0`);
    return n;
}

function toCount(val, label, min) {
    const n = parseInt(val, 10);
    if (!Number.isInteger(n) || n < min || n > 60) throw new Error(`INVALID:${label} must be a number between ${min} and 60`);
    return n;
}

function buildHolidayData(body, existing) {
    const data = {};
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
    const text = (k, label, max, required) => {
        if (!has(k)) return;
        const v = String(body[k] ?? '').trim().slice(0, max);
        if (required && !v) throw new Error(`INVALID:${label} is required`);
        data[k] = v;
    };

    if (has('category')) {
        const c = String(body.category || '').toUpperCase();
        if (!CATEGORIES.includes(c)) throw new Error('INVALID:Category must be LOCAL or INTERNATIONAL');
        data.category = c;
    }
    text('region', 'Collection', 80, true);
    text('state', 'Destination', 120, true);
    text('packageName', 'Package name', 160, true);
    text('tagline', 'Tagline', 200, false);
    text('experienceType', 'Experience identity', 200, false);
    if (has('notes')) data.notes = String(body.notes ?? '').trim().slice(0, 2000) || null;

    if (has('durationDays')) data.durationDays = toCount(body.durationDays, 'Days', 1);
    if (has('durationNights')) data.durationNights = toCount(body.durationNights, 'Nights', 0);

    if (has('price')) data.price = toPrice(body.price, 'Price');
    if (has('priceSingle')) data.priceSingle = toPrice(body.priceSingle, 'Single occupancy price');
    if (has('priceSharing')) data.priceSharing = toPrice(body.priceSharing, 'Per person sharing price');

    if (has('attractions')) data.attractions = toList(body.attractions).slice(0, 40);
    if (has('inclusions')) data.inclusions = toList(body.inclusions).slice(0, 40);
    if (has('images')) data.images = toList(body.images).slice(0, 10);

    if (has('sortOrder')) {
        const n = parseInt(body.sortOrder, 10);
        data.sortOrder = Number.isInteger(n) ? n : 0;
    }
    if (has('status')) {
        const s = String(body.status || '').toUpperCase();
        if (!STATUSES.includes(s)) throw new Error('INVALID:Status must be ACTIVE, DRAFT or ARCHIVED');
        data.status = s;
    }

    const merged = { ...(existing || {}), ...data };
    const category = merged.category || 'LOCAL';
    if ((merged.durationNights ?? 0) > (merged.durationDays ?? 0)) {
        throw new Error('INVALID:Nights cannot be more than days');
    }
    if (merged.status === 'ACTIVE') {
        if (category === 'LOCAL' && !standardPrice(merged)) {
            throw new Error('INVALID:An active local package needs a price');
        }
        if (category === 'INTERNATIONAL' && !merged.priceSingle && !merged.priceSharing) {
            throw new Error('INVALID:An active international package needs a single or sharing price');
        }
    }
    return data;
}

function sendInvalid(res, err) {
    if (err && typeof err.message === 'string' && err.message.startsWith('INVALID:')) {
        res.status(400).json({ ok: false, error: err.message.slice(8) });
        return true;
    }
    if (err && err.code === 'P2002') {
        res.status(400).json({ ok: false, error: 'A package with this name already exists for this destination' });
        return true;
    }
    return false;
}

async function listHolidays(req, res) {
    try {
        const { region, category } = req.query;
        const where = { status: 'ACTIVE' };
        if (region) where.region = region;
        if (category && CATEGORIES.includes(String(category).toUpperCase())) where.category = String(category).toUpperCase();

        const holidays = await db.holiday.findMany({
            where,
            include: {
                dates: {
                    where: { date: { gte: new Date() } },
                    orderBy: { date: 'asc' },
                },
            },
            orderBy: [{ sortOrder: 'asc' }, { packageName: 'asc' }],
        });

        const withAvailability = holidays.map(h => {
            const openDates = h.dates.filter(d => d.bookedCount < d.capacity);
            return {
                ...publicHoliday(h),
                hasAvailability: openDates.length > 0,
                nextDate: openDates.length ? openDates[0].date : null,
                openDateCount: openDates.length,
                upcomingDateCount: h.dates.length,
                dates: openDates.slice(0, 3),
            };
        });

        // Packages with open dates first, soonest departure leading; the rest keep their admin order.
        const nextTime = h => (h.nextDate ? new Date(h.nextDate).getTime() : Infinity);
        const grouped = {};
        for (const h of withAvailability) {
            if (!grouped[h.region]) grouped[h.region] = [];
            grouped[h.region].push(h);
        }
        for (const r of Object.keys(grouped)) {
            grouped[r] = grouped[r]
                .map((h, i) => ({ h, i }))
                .sort((a, b) => (nextTime(a.h) - nextTime(b.h)) || (a.i - b.i))
                .map(x => x.h);
        }

        const extra = Object.keys(grouped).filter(r => !REGION_ORDER.includes(r)).sort();
        const ordered = [...REGION_ORDER.filter(r => grouped[r]), ...extra].map(r => ({
            region: r,
            category: grouped[r][0].category,
            nextDate: grouped[r][0].nextDate,
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

        if (!holiday || holiday.status !== 'ACTIVE') return res.status(404).json({ ok: false, error: 'Package not found' });

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

        return res.json({ ok: true, data: { holiday: { ...publicHoliday(holiday), availableDates, hasAvailability } } });
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
            endDate: d.endDate,
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
            occupancy,
            leadName,
            leadEmail,
            leadPhone,
            addMembership,
            additionalTravellers,
        } = req.body;

        const userId = req.user.id;
        const travellers = parseInt(req.body.travellers, 10);

        if (!holidayId || !holidayDateId || !leadName || !leadEmail) {
            return res.status(400).json({ ok: false, error: 'Missing required fields' });
        }
        if (!Number.isInteger(travellers) || travellers < 1 || travellers > MAX_TRAVELLERS) {
            return res.status(400).json({ ok: false, error: `Travellers must be between 1 and ${MAX_TRAVELLERS}` });
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

        const holiday = await db.holiday.findUnique({ where: { id: holidayId } });
        if (!holiday || holiday.status !== 'ACTIVE') {
            return res.status(404).json({ ok: false, error: 'Package not found' });
        }

        const slot = await db.holidayDate.findUnique({ where: { id: holidayDateId } });
        if (!slot || slot.holidayId !== holidayId) {
            return res.status(404).json({ ok: false, error: 'Date not found' });
        }
        if (new Date(slot.date) < new Date()) {
            return res.status(400).json({ ok: false, error: 'This date has already passed' });
        }
        if (slot.bookedCount + travellers > slot.capacity) {
            return res.status(400).json({ ok: false, error: 'Not enough availability for this date' });
        }

        let occ = null;
        if (holiday.category === 'INTERNATIONAL') {
            occ = String(occupancy || '').toUpperCase();
            if (!OCCUPANCIES.includes(occ)) {
                return res.status(400).json({ ok: false, error: 'Please choose single occupancy or per person sharing' });
            }
        }

        const unitPrice = unitPriceFor(holiday, occ);
        if (!unitPrice) {
            return res.status(400).json({ ok: false, error: 'This package is not currently priced for that option' });
        }

        const tierAmount = unitPrice * travellers;

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
                tier: null,
                occupancy: occ,
                unitPrice,
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
                    unitPrice,
                    occupancy: occ,
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
                        category: true,
                        durationDays: true,
                        durationNights: true,
                        images: true,
                    },
                },
                holidayDate: {
                    select: { date: true, endDate: true },
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
            include: {
                dates: { orderBy: { date: 'asc' } },
                _count: { select: { bookings: true } },
            },
            orderBy: [{ category: 'asc' }, { region: 'asc' }, { sortOrder: 'asc' }, { packageName: 'asc' }],
        });
        return res.json({
            ok: true,
            data: {
                holidays: holidays.map(h => ({ ...h, price: standardPrice(h), startingPrice: startingPrice(h) })),
                collections: REGION_ORDER,
            },
        });
    } catch (err) {
        console.error('adminListPackages error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to load packages' });
    }
}

function parseDay(v) {
    if (!v) return null;
    const str = String(v).trim();
    const d = /^\d{4}-\d{2}-\d{2}$/.test(str) ? new Date(str + 'T00:00:00.000Z') : new Date(str);
    return isNaN(d.getTime()) ? undefined : d;
}

function checkSlot(input, existing) {
    const start = input.date !== undefined ? parseDay(input.date) : existing?.date;
    if (!start) return { error: 'Start date is required' };
    const end = input.endDate !== undefined ? parseDay(input.endDate) : existing?.endDate ?? null;
    if (end === undefined) return { error: 'End date is not a valid date' };
    if (end && end < start) return { error: 'End date cannot be before the start date' };
    let capacity = existing ? existing.capacity : 20;
    if (input.capacity !== undefined && input.capacity !== null && input.capacity !== '') {
        capacity = parseInt(input.capacity, 10);
        if (!Number.isInteger(capacity) || capacity < 1 || capacity > 1000) return { error: 'Capacity must be between 1 and 1000' };
    }
    if (existing && capacity < existing.bookedCount) {
        return { error: `Capacity cannot be lower than the ${existing.bookedCount} spot(s) already booked` };
    }
    return { data: { date: start, endDate: end, capacity } };
}

async function adminCreateDate(req, res) {
    try {
        const holiday = await db.holiday.findUnique({ where: { id: req.params.holidayId } });
        if (!holiday) return res.status(404).json({ ok: false, error: 'Package not found' });

        const items = Array.isArray(req.body?.dates) ? req.body.dates : [req.body || {}];
        if (!items.length) return res.status(400).json({ ok: false, error: 'Add at least one date' });
        if (items.length > 50) return res.status(400).json({ ok: false, error: 'Add at most 50 dates at a time' });

        const rows = [];
        for (let i = 0; i < items.length; i++) {
            const checked = checkSlot(items[i]);
            if (checked.error) {
                return res.status(400).json({ ok: false, error: items.length > 1 ? `Row ${i + 1}: ${checked.error}` : checked.error });
            }
            rows.push({ holidayId: holiday.id, ...checked.data });
        }

        const key = r => `${r.date.toISOString().slice(0, 10)}|${r.endDate ? r.endDate.toISOString().slice(0, 10) : ''}`;
        const existing = await db.holidayDate.findMany({ where: { holidayId: holiday.id }, select: { date: true, endDate: true } });
        const seen = new Set(existing.map(key));
        for (let i = 0; i < rows.length; i++) {
            const k = key(rows[i]);
            if (seen.has(k)) {
                const label = rows[i].date.toISOString().slice(0, 10) + (rows[i].endDate ? ' to ' + rows[i].endDate.toISOString().slice(0, 10) : '');
                return res.status(400).json({ ok: false, error: `${items.length > 1 ? `Row ${i + 1}: ` : ''}${label} is already a trip date for this package` });
            }
            seen.add(k);
        }

        const created = await db.$transaction(rows.map(data => db.holidayDate.create({ data })));
        return res.status(201).json({ ok: true, data: { date: created[0], dates: created } });
    } catch (err) {
        console.error('adminCreateDate error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to create date' });
    }
}

async function adminUpdateDate(req, res) {
    try {
        const existing = await db.holidayDate.findUnique({ where: { id: req.params.dateId } });
        if (!existing) return res.status(404).json({ ok: false, error: 'Date not found' });
        const checked = checkSlot(req.body || {}, existing);
        if (checked.error) return res.status(400).json({ ok: false, error: checked.error });
        const updated = await db.holidayDate.update({ where: { id: existing.id }, data: checked.data });
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

async function adminCreateHoliday(req, res) {
    try {
        const body = { status: 'DRAFT', category: 'LOCAL', durationDays: 3, durationNights: 2, attractions: [], inclusions: [], ...req.body };
        for (const k of ['region', 'state', 'packageName']) {
            if (!String(body[k] || '').trim()) {
                return res.status(400).json({ ok: false, error: 'Collection, destination and package name are required' });
            }
        }
        const data = buildHolidayData(body, null);
        const created = await db.holiday.create({
            data: {
                tagline: '',
                experienceType: '',
                ...data,
            },
        });
        return res.status(201).json({ ok: true, data: { holiday: created } });
    } catch (err) {
        if (sendInvalid(res, err)) return;
        console.error('adminCreateHoliday error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to create package' });
    }
}

async function adminUpdateHoliday(req, res) {
    try {
        const holiday = await db.holiday.findUnique({ where: { id: req.params.id } });
        if (!holiday) return res.status(404).json({ ok: false, error: 'Package not found' });

        const body = { ...req.body };
        delete body.id;
        const data = buildHolidayData(body, holiday);

        const updated = await db.holiday.update({
            where: { id: req.params.id },
            data,
        });

        return res.json({ ok: true, data: { holiday: updated } });
    } catch (err) {
        if (sendInvalid(res, err)) return;
        console.error('adminUpdateHoliday error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to update package' });
    }
}

async function adminDeleteHoliday(req, res) {
    try {
        const holiday = await db.holiday.findUnique({
            where: { id: req.params.id },
            include: { _count: { select: { bookings: true } } },
        });
        if (!holiday) return res.status(404).json({ ok: false, error: 'Package not found' });
        if (holiday._count.bookings > 0) {
            return res.status(400).json({ ok: false, error: 'This package has bookings. Archive it instead of deleting it.' });
        }
        await db.holiday.delete({ where: { id: req.params.id } });
        return res.json({ ok: true });
    } catch (err) {
        console.error('adminDeleteHoliday error:', err);
        return res.status(500).json({ ok: false, error: 'Failed to delete package' });
    }
}

module.exports = {
    listHolidays, getHoliday, getAvailability, createBooking, myBookings,
    adminListPackages, adminCreateDate, adminUpdateDate, adminDeleteDate,
    adminListBookings, adminUpdateBookingStatus, adminUpdateHoliday,
    adminCreateHoliday, adminDeleteHoliday,
    _internal: { buildHolidayData, unitPriceFor, startingPrice, standardPrice },
};