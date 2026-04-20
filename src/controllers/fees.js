const cache = require('../services/cache');
const { z } = require('zod');
const prisma = require('../utils/prisma');

// ─── GET /fees ────────────────────────────────────────────────────────────────
exports.getAll = async (req, res, next) => {
  try {
    const cacheKey = 'fees:all';
    const cached = cache.get(cacheKey);
    if (cached) return res.json({ ok: true, data: cached });

    const [fees, svcRow] = await Promise.all([
      prisma.fee.findMany({ orderBy: { country: 'asc' } }),
      prisma.serviceFee.findUnique({ where: { id: 'singleton' } }),
    ]);

    const destinations = {};
    const enabledCountries = [];
    fees.forEach(f => {
      destinations[f.country] = f.amount;
      if (f.enabled) enabledCountries.push(f.country);
    });

    const data = { serviceFee: svcRow?.amount ?? 25000, destinations, enabledCountries };
    cache.set(cacheKey, data, 30 * 60 * 1000);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// ─── PUT /fees/service ────────────────────────────────────────────────────────
exports.setServiceFee = async (req, res, next) => {
  try {
    const { amount } = z.object({ amount: z.number().min(0) }).parse(req.body);
    const svc = await prisma.serviceFee.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', amount },
      update: { amount },
    });
    cache.del('fees:all');
    res.json({ ok: true, data: { serviceFee: svc.amount } });
  } catch (err) { next(err); }
};

// ─── PUT /fees/:country ───────────────────────────────────────────────────────
exports.setDestinationFee = async (req, res, next) => {
  try {
    const { amount } = z.object({ amount: z.number().min(0) }).parse(req.body);
    const country = decodeURIComponent(req.params.country);
    const fee = await prisma.fee.upsert({
      where: { country },
      create: { country, amount, isDefault: false, enabled: true },
      update: { amount },
    });
    res.json({ ok: true, data: { country: fee.country, amount: fee.amount } });
  } catch (err) { next(err); }
};

// ─── PATCH /fees/:country/toggle ──────────────────────────────────────────────
exports.toggleCountry = async (req, res, next) => {
  try {
    const country = decodeURIComponent(req.params.country);
    const existing = await prisma.fee.findUnique({ where: { country } });
    const currentEnabled = existing?.enabled ?? true;
    const fee = await prisma.fee.upsert({
      where: { country },
      create: { country, amount: 0, isDefault: false, enabled: !currentEnabled },
      update: { enabled: !currentEnabled },
    });
    res.json({ ok: true, data: { country: fee.country, enabled: fee.enabled } });
  } catch (err) { next(err); }
};

// ─── DELETE /fees/:country ────────────────────────────────────────────────────
exports.resetDestinationFee = async (req, res, next) => {
  try {
    const country = decodeURIComponent(req.params.country);
    await prisma.fee.deleteMany({ where: { country, isDefault: false } });
    res.json({ ok: true, data: { message: `${country} fee reset to default.` } });
  } catch (err) { next(err); }
};