const { z } = require('zod');
const prisma = require('../utils/prisma');

// ─── GET /visa-requirements ───────────────────────────────────────────────────
exports.getAll = async (req, res, next) => {
  try {
    const where = {};
    if (req.query.country) where.country = { equals: req.query.country, mode: 'insensitive' };
    if (req.query.region)  where.region  = { equals: req.query.region,  mode: 'insensitive' };

    const reqs = await prisma.visaRequirement.findMany({ where, orderBy: { country: 'asc' } });

    const requirements = {};
    let latestUpdate = null;

    reqs.forEach(r => {
      requirements[r.country] = {
        flag:       r.flag,
        region:     r.region,
        type:       r.visaType,
        fee:        r.fee,
        processing: r.processing,
        docs:       r.docs || [],
      };
      if (!latestUpdate || r.updatedAt > latestUpdate) latestUpdate = r.updatedAt;
    });

    res.set('Cache-Control', 'public, max-age=3600');
    res.json({ ok: true, data: { requirements, updatedAt: latestUpdate } });
  } catch (err) { next(err); }
};

// ─── PUT /visa-requirements/:country ─────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const schema = z.object({
      flag:       z.string().optional(),
      region:     z.string().optional(),
      visaType:   z.string().optional(),
      fee:        z.string().optional(),
      processing: z.string().optional(),
      docs:       z.array(z.string()).optional(),
    });
    const data = schema.parse(req.body);
    const country = decodeURIComponent(req.params.country);

    const req_ = await prisma.visaRequirement.upsert({
      where:  { country },
      create: { country, ...data },
      update: data,
    });

    res.json({ ok: true, data: { country: req_ } });
  } catch (err) { next(err); }
};
