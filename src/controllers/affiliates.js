const { z } = require('zod');
const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { ApiError } = require('../middleware/error');

// ─── POST /affiliates/apply ───────────────────────────────────────────────────
exports.apply = async (req, res, next) => {
    try {
        const schema = z.object({
            name: z.string().min(2),
            email: z.string().email(),
            phone: z.string().min(7),
            location: z.string().optional(),
            channel: z.string().optional(),
            audienceSize: z.string().optional(),
            profileUrl: z.string().url().optional().or(z.literal('')),
            motivation: z.string().optional(),
            bankAccount: z.string().min(10),
            bankName: z.string().min(2),
            accountName: z.string().min(2),
        });

        const data = schema.parse(req.body);

        const existing = await prisma.affiliate.findUnique({ where: { email: data.email } });
        if (existing) {
            return res.status(409).json({ ok: false, error: 'An application with this email already exists.' });
        }

        const referralCode = 'JKF-' + crypto.randomBytes(4).toString('hex').toUpperCase();

        const affiliate = await prisma.affiliate.create({
            data: {
                ...data,
                profileUrl: data.profileUrl || null,
                referralCode,
                userId: req.user?.id || null,
            },
        });

        res.status(201).json({ ok: true, data: { affiliate } });
    } catch (err) { next(err); }
};

// ─── GET /affiliates/me ───────────────────────────────────────────────────────
exports.getMe = async (req, res, next) => {
    try {
        const affiliate = await prisma.affiliate.findFirst({
            where: { userId: req.user.id },
        });
        if (!affiliate) throw new ApiError('Affiliate profile not found.', 404);

        res.json({ ok: true, data: { affiliate: fmtAffiliate(affiliate) } });
    } catch (err) { next(err); }
};

// ─── GET /affiliates/stats ────────────────────────────────────────────────────
exports.getStats = async (req, res, next) => {
    try {
        const affiliate = await prisma.affiliate.findFirst({
            where: { userId: req.user.id },
            include: { payouts: { orderBy: { requestedAt: 'desc' }, take: 10 } },
        });
        if (!affiliate) throw new ApiError('Affiliate profile not found.', 404);

        res.json({
            ok: true,
            data: {
                referralCode: affiliate.referralCode,
                totalClicks: affiliate.totalClicks,
                totalReferrals: affiliate.totalReferrals,
                totalEarned: affiliate.totalEarned / 100,   // kobo → naira
                totalPaid: affiliate.totalPaid / 100,
                balance: affiliate.balance / 100,
                payouts: affiliate.payouts.map(fmtPayout),
            },
        });
    } catch (err) { next(err); }
};

// ─── GET /affiliates/payouts ──────────────────────────────────────────────────
exports.getPayouts = async (req, res, next) => {
    try {
        const affiliate = await prisma.affiliate.findFirst({ where: { userId: req.user.id } });
        if (!affiliate) throw new ApiError('Affiliate profile not found.', 404);

        const payouts = await prisma.affiliatePayout.findMany({
            where: { affiliateId: affiliate.id },
            orderBy: { requestedAt: 'desc' },
        });

        res.json({ ok: true, data: { payouts: payouts.map(fmtPayout) } });
    } catch (err) { next(err); }
};

// ─── POST /affiliates/payouts/request ────────────────────────────────────────
exports.requestPayout = async (req, res, next) => {
    try {
        const schema = z.object({
            amount: z.number().min(1000),
            bankDetails: z.object({
                bankName: z.string().min(2),
                accountNumber: z.string().min(10),
                accountName: z.string().min(2),
            }),
        });

        const { amount, bankDetails } = schema.parse(req.body);
        const amountKobo = Math.round(amount * 100);

        const affiliate = await prisma.affiliate.findFirst({ where: { userId: req.user.id } });
        if (!affiliate) throw new ApiError('Affiliate profile not found.', 404);
        if (affiliate.status !== 'APPROVED') throw new ApiError('Your affiliate application is not yet approved.', 403);
        if (affiliate.balance < amountKobo) throw new ApiError('Insufficient balance.', 400);

        const payout = await prisma.affiliatePayout.create({
            data: {
                affiliateId: affiliate.id,
                amount: amountKobo,
                bankName: bankDetails.bankName,
                accountNumber: bankDetails.accountNumber,
                accountName: bankDetails.accountName,
                status: 'PENDING',
            },
        });

        res.status(201).json({ ok: true, data: { payout: fmtPayout(payout) } });
    } catch (err) { next(err); }
};

// ─── GET /admin/affiliates ────────────────────────────────────────────────────
exports.adminList = async (req, res, next) => {
    try {
        const affiliates = await prisma.affiliate.findMany({
            orderBy: { createdAt: 'desc' },
            include: {
                payouts: {
                    where: { status: 'PENDING' },
                    orderBy: { requestedAt: 'desc' },
                },
            },
        });

        res.json({
            ok: true,
            data: {
                affiliates: affiliates.map(a => ({
                    id: a.id,
                    name: a.name,
                    email: a.email,
                    phone: a.phone,
                    location: a.location,
                    channel: a.channel,
                    audienceSize: a.audienceSize,
                    profileUrl: a.profileUrl,
                    motivation: a.motivation,
                    bankAccount: a.bankAccount,
                    bankName: a.bankName,
                    accountName: a.accountName,
                    referralCode: a.referralCode,
                    status: a.status.toLowerCase(),
                    totalClicks: a.totalClicks,
                    totalReferrals: a.totalReferrals,
                    totalEarned: a.totalEarned / 100,
                    totalPaid: a.totalPaid / 100,
                    balance: a.balance / 100,
                    pendingPayouts: a.payouts.map(fmtPayout),
                    createdAt: a.createdAt,
                })),
            },
        });
    } catch (err) { next(err); }
};

// ─── PATCH /admin/affiliates/:id/status ──────────────────────────────────────
exports.adminUpdateStatus = async (req, res, next) => {
    try {
        const { status } = z.object({
            status: z.enum(['APPROVED', 'REJECTED', 'PENDING']),
        }).parse(req.body);

        const affiliate = await prisma.affiliate.findUnique({ where: { id: req.params.id } });
        if (!affiliate) throw new ApiError('Affiliate not found.', 404);

        const updated = await prisma.affiliate.update({
            where: { id: req.params.id },
            data: { status },
        });

        res.json({ ok: true, data: { affiliate: { id: updated.id, status: updated.status.toLowerCase() } } });
    } catch (err) { next(err); }
};

// ─── PATCH /admin/affiliates/payouts/:payoutId/process ───────────────────────
exports.adminProcessPayout = async (req, res, next) => {
    try {
        const payout = await prisma.affiliatePayout.findUnique({
            where: { id: req.params.payoutId },
            include: { affiliate: true },
        });
        if (!payout) throw new ApiError('Payout not found.', 404);
        if (payout.status === 'PROCESSED') throw new ApiError('Payout already processed.', 400);

        await prisma.$transaction([
            prisma.affiliatePayout.update({
                where: { id: payout.id },
                data: { status: 'PROCESSED', processedAt: new Date() },
            }),
            prisma.affiliate.update({
                where: { id: payout.affiliateId },
                data: {
                    totalPaid: { increment: payout.amount },
                    balance: { decrement: payout.amount },
                },
            }),
        ]);

        res.json({ ok: true, data: { message: 'Payout marked as processed.' } });
    } catch (err) { next(err); }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtAffiliate = (a) => ({
    id: a.id,
    name: a.name,
    email: a.email,
    phone: a.phone,
    referralCode: a.referralCode,
    status: a.status.toLowerCase(),
    totalClicks: a.totalClicks,
    totalReferrals: a.totalReferrals,
    totalEarned: a.totalEarned / 100,
    totalPaid: a.totalPaid / 100,
    balance: a.balance / 100,
    createdAt: a.createdAt,
});

const fmtPayout = (p) => ({
    id: p.id,
    amount: p.amount / 100,
    status: p.status.toLowerCase(),
    bankName: p.bankName,
    accountNumber: p.accountNumber,
    accountName: p.accountName,
    note: p.note,
    requestedAt: p.requestedAt,
    processedAt: p.processedAt,
});