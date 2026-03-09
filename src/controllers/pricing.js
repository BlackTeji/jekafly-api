const { z } = require('zod');
const prisma = require('../utils/prisma');
const { ApiError } = require('../middleware/error');

const SINGLETON_ID = 'singleton';

const pricingSchema = z.object({
    consultStandard: z.number().int().min(0).optional(),
    consultPriority: z.number().int().min(0).optional(),
    consultVip: z.number().int().min(0).optional(),
    insuranceBasic: z.number().int().min(0).optional(),
    insuranceStandard: z.number().int().min(0).optional(),
    insurancePremium: z.number().int().min(0).optional(),
});

// GET /pricing — public, returns current prices
exports.get = async (req, res, next) => {
    try {
        const config = await prisma.pricingConfig.upsert({
            where: { id: SINGLETON_ID },
            create: { id: SINGLETON_ID },
            update: {},
        });
        res.json({ ok: true, data: { pricing: config } });
    } catch (err) { next(err); }
};

// PATCH /pricing — admin only, update any subset of prices
exports.update = async (req, res, next) => {
    try {
        if (req.user?.role !== 'ADMIN') throw new ApiError('Forbidden', 403);
        const data = pricingSchema.parse(req.body);
        if (!Object.keys(data).length) throw new ApiError('No fields to update.', 400);

        const config = await prisma.pricingConfig.upsert({
            where: { id: SINGLETON_ID },
            create: { id: SINGLETON_ID, ...data },
            update: data,
        });
        res.json({ ok: true, data: { pricing: config } });
    } catch (err) { next(err); }
};