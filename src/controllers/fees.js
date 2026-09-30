const cache = require('../services/cache');
const { z } = require('zod');
const prisma = require('../utils/prisma');
const pricing = require('../services/pricing');

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
      destinations[f.country] = f.amount > 0 ? f.amount : pricing.defaultVisaFee(f.country);
      if (f.enabled) enabledCountries.push(f.country);
    });

    const data = {
      serviceFee: svcRow?.amount ?? null,
      destinations,
      enabledCountries,
      defaults: pricing.VISA_FEE_FALLBACK,
      fallbackFee: pricing.DEFAULT_VISA_FEE,
      extraTravellerRate: 0.85,
    };
    cache.set(cacheKey, data, 30 * 60 * 1000);
    res.json({ ok: true, data });
  } catch (err) { next(err); }
};

// ─── PUT /fees/service ────────────────────────────────────────────────────────
exports.setServiceFee = async (req, res, next) => {
  try {
    const { amount } = z.object({ amount: z.number().int('Enter a whole naira amount').min(0).max(10000000) }).parse(req.body);
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
    const { amount, enabled } = z.object({
      amount: z.number().int().min(1000, 'Fee must be at least ₦1,000'),
      enabled: z.boolean().optional(),
    }).parse(req.body);
    const country = decodeURIComponent(req.params.country).trim();
    if (!country) throw new Error('Country is required');
    const fee = await prisma.fee.upsert({
      where: { country },
      create: { country, amount, isDefault: false, enabled: enabled ?? true },
      update: { amount, ...(enabled !== undefined && { enabled }) },
    });
    cache.del('fees:all');
    res.json({ ok: true, data: { country: fee.country, amount: fee.amount } });
  } catch (err) { next(err); }
};

// ─── PATCH /fees/:country/toggle ──────────────────────────────────────────────
exports.toggleCountry = async (req, res, next) => {
  try {
    const country = decodeURIComponent(req.params.country);
    const existing = await prisma.fee.findUnique({ where: { country } });
    const nextEnabled = existing ? !existing.enabled : true;
    const amount = existing && existing.amount > 0 ? existing.amount : pricing.defaultVisaFee(country);
    const fee = await prisma.fee.upsert({
      where: { country },
      create: { country, amount, isDefault: false, enabled: nextEnabled },
      update: { enabled: nextEnabled, amount },
    });
    cache.del('fees:all');
    res.json({ ok: true, data: { country: fee.country, enabled: fee.enabled } });
  } catch (err) { next(err); }
};

// ─── DELETE /fees/:country ────────────────────────────────────────────────────
exports.resetDestinationFee = async (req, res, next) => {
  try {
    const country = decodeURIComponent(req.params.country);
    await prisma.fee.deleteMany({ where: { country, isDefault: false } });
    cache.del('fees:all');
    res.json({ ok: true, data: { message: `${country} fee reset to default.` } });
  } catch (err) { next(err); }
};