const prisma = require('../utils/prisma');
const { ApiError } = require('../middleware/error');

// ─── GET /insurance ───────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const policies = await prisma.insurancePolicy.findMany({
      where: { userId: req.user.id },
      orderBy: { purchasedAt: 'desc' },
    });
    res.json({ ok: true, data: { policies: policies.map(fmt) } });
  } catch (err) { next(err); }
};

// ─── GET /insurance/:id ───────────────────────────────────────────────────────
exports.getOne = async (req, res, next) => {
  try {
    const policy = await prisma.insurancePolicy.findUnique({ where: { id: req.params.id } });
    if (!policy) throw new ApiError('Policy not found.', 404);
    if (policy.userId !== req.user.id && req.user.role !== 'ADMIN') {
      throw new ApiError('Not authorised.', 403);
    }
    res.json({ ok: true, data: { policy: fmt(policy) } });
  } catch (err) { next(err); }
};

const fmt = (p) => ({
  id:          p.id,
  plan:        p.plan,
  destination: p.destination,
  date:        p.travelDate,
  travellers:  p.travellers,
  amount:      p.amount,
  status:      p.status,
  purchasedAt: p.purchasedAt,
});
