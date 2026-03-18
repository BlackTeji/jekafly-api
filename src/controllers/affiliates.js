const { z } = require('zod');
const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { ApiError } = require('../middleware/error');
const { emails } = require('../services/email');

// ── Helpers ────────────────────────────────────────────────────────────────────
const generateCode = (name) => {
    const base = name.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 5);
    const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
    return `${base}${rand}`;
};

const fmtAffiliate = (a) => ({
    ...a,
    totalEarned: a.totalEarned / 100,
    totalPaid: a.totalPaid / 100,
    balance: a.balance / 100,
    payouts: (a.payouts || []).map(p => ({
        ...p,
        amount: p.amount / 100,
    })),
});

const applySchema = z.object({
    name: z.string().min(2),
    email: z.string().email(),
    phone: z.string().min(7),
    location: z.string().optional(),
    channel: z.string().optional(),
    audienceSize: z.string().optional(),
    profileUrl: z.string().url().optional().or(z.literal('')).or(z.null()),
    motivation: z.string().optional().or(z.null()),
    bankAccount: z.string().length(10).regex(/^\d+$/, 'Must be 10 digits'),
    bankName: z.string().min(2),
    accountName: z.string().min(2),
});

// ── POST /affiliates/apply ─────────────────────────────────────────────────────
exports.apply = async (req, res, next) => {
    try {
        const data = applySchema.parse(req.body);

        const existing = await prisma.affiliate.findUnique({ where: { email: data.email } });
        if (existing) {
            return res.status(409).json({
                ok: false,
                error: existing.status === 'REJECTED'
                    ? 'A previous application with this email was rejected. Please contact us to reapply.'
                    : 'An application with this email already exists.',
            });
        }

        let code = generateCode(data.name);
        let attempts = 0;
        while (await prisma.affiliate.findUnique({ where: { referralCode: code } })) {
            code = generateCode(data.name + attempts++);
        }

        const affiliate = await prisma.affiliate.create({
            data: {
                ...data,
                profileUrl: data.profileUrl || null,
                motivation: data.motivation || null,
                userId: req.user?.id || null,
                referralCode: code,
                status: 'PENDING',
            },
        });

        emails.affiliateApplicationReceived(affiliate).catch(() => { });

        res.status(201).json({
            ok: true,
            data: { affiliate: fmtAffiliate(affiliate) },
        });
    } catch (err) { next(err); }
};

// ── GET /affiliates/me ─────────────────────────────────────────────────────────
exports.getMe = async (req, res, next) => {
    try {
        const user = req.user;
        const affiliate = await prisma.affiliate.findFirst({
            where: {
                OR: [
                    { userId: user.id },
                    { email: user.email },
                ],
            },
            include: { payouts: { orderBy: { requestedAt: 'desc' } } },
        });

        if (!affiliate) {
            return res.json({ ok: true, data: null });
        }

        const stats = {
            clicks: affiliate.totalClicks,
            conversions: affiliate.totalReferrals,
            totalEarned: affiliate.totalEarned / 100,
            pendingPayout: affiliate.balance / 100,
        };

        res.json({
            ok: true,
            data: {
                affiliate: fmtAffiliate(affiliate),
                stats,
            },
        });
    } catch (err) { next(err); }
};

// ── GET /affiliates/stats ──────────────────────────────────────────────────────
exports.getStats = async (req, res, next) => {
    try {
        const user = req.user;
        const affiliate = await prisma.affiliate.findFirst({
            where: { OR: [{ userId: user.id }, { email: user.email }] },
        });
        if (!affiliate) return res.json({ ok: true, data: { clicks: 0, conversions: 0, totalEarned: 0, pendingPayout: 0 } });

        res.json({
            ok: true,
            data: {
                clicks: affiliate.totalClicks,
                conversions: affiliate.totalReferrals,
                totalEarned: affiliate.totalEarned / 100,
                pendingPayout: affiliate.balance / 100,
            },
        });
    } catch (err) { next(err); }
};

// ── GET /affiliates/payouts ────────────────────────────────────────────────────
exports.getPayouts = async (req, res, next) => {
    try {
        const user = req.user;
        const affiliate = await prisma.affiliate.findFirst({
            where: { OR: [{ userId: user.id }, { email: user.email }] },
            include: { payouts: { orderBy: { requestedAt: 'desc' } } },
        });
        if (!affiliate) return res.json({ ok: true, data: { payouts: [] } });

        const payouts = affiliate.payouts.map(p => ({ ...p, amount: p.amount / 100 }));
        res.json({ ok: true, data: { payouts } });
    } catch (err) { next(err); }
};

// ── POST /affiliates/payouts/request ──────────────────────────────────────────
exports.requestPayout = async (req, res, next) => {
    try {
        const { amount } = z.object({ amount: z.number().min(100) }).parse(req.body);
        const amountKobo = Math.round(amount * 100);

        const user = req.user;
        const affiliate = await prisma.affiliate.findFirst({
            where: { OR: [{ userId: user.id }, { email: user.email }] },
        });
        if (!affiliate) throw new ApiError('Affiliate account not found.', 404);
        if (affiliate.status !== 'APPROVED') throw new ApiError('Your affiliate account is not yet approved.', 403);
        if (affiliate.balance < amountKobo) throw new ApiError('Insufficient balance.', 400);

        const payout = await prisma.affiliatePayout.create({
            data: {
                affiliateId: affiliate.id,
                amount: amountKobo,
                bankName: affiliate.bankName,
                accountNumber: affiliate.bankAccount,
                accountName: affiliate.accountName,
                status: 'PENDING',
            },
        });

        await prisma.affiliate.update({
            where: { id: affiliate.id },
            data: { balance: { decrement: amountKobo } },
        });

        res.status(201).json({ ok: true, data: { payout: { ...payout, amount: payout.amount / 100 } } });
    } catch (err) { next(err); }
};

// ── GET /admin/affiliates ──────────────────────────────────────────────────────
exports.adminList = async (req, res, next) => {
    try {
        const status = req.query.status?.toUpperCase();
        const where = status ? { status } : {};

        const affiliates = await prisma.affiliate.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            include: { payouts: { orderBy: { requestedAt: 'desc' } } },
        });

        res.json({ ok: true, data: { affiliates: affiliates.map(fmtAffiliate) } });
    } catch (err) { next(err); }
};

// ── PATCH /admin/affiliates/:id/status ────────────────────────────────────────
exports.adminUpdateStatus = async (req, res, next) => {
    try {
        const { status } = z.object({
            status: z.enum(['APPROVED', 'REJECTED']),
        }).parse(req.body);

        const affiliate = await prisma.affiliate.findUnique({ where: { id: req.params.id } });
        if (!affiliate) throw new ApiError('Affiliate not found.', 404);

        const updated = await prisma.affiliate.update({
            where: { id: req.params.id },
            data: { status },
        });

        if (status === 'APPROVED') {
            emails.affiliateApproved(updated).catch(() => { });
        } else {
            emails.affiliateRejected(updated).catch(() => { });
        }

        res.json({ ok: true, data: { affiliate: fmtAffiliate(updated) } });
    } catch (err) { next(err); }
};

// ── PATCH /admin/affiliates/payouts/:payoutId/process ─────────────────────────
exports.adminProcessPayout = async (req, res, next) => {
    try {
        const payout = await prisma.affiliatePayout.findUnique({
            where: { id: req.params.payoutId },
            include: { affiliate: true },
        });
        if (!payout) throw new ApiError('Payout not found.', 404);
        if (payout.status === 'PROCESSED') throw new ApiError('Payout already processed.', 400);

        const updated = await prisma.affiliatePayout.update({
            where: { id: payout.id },
            data: {
                status: 'PROCESSED',
                processedAt: new Date(),
            },
        });

        await prisma.affiliate.update({
            where: { id: payout.affiliateId },
            data: { totalPaid: { increment: payout.amount } },
        });

        res.json({ ok: true, data: { payout: { ...updated, amount: updated.amount / 100 } } });
    } catch (err) { next(err); }
};