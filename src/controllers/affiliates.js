const { z } = require('zod');
const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { ApiError } = require('../middleware/error');

const magicTokenStore = new Map();

exports.apply = async (req, res, next) => {
    try {
        const schema = z.object({
            name: z.string().min(2),
            email: z.string().email(),
            phone: z.string().min(7),
            location: z.string().optional(),
            channel: z.string().optional(),
            audienceSize: z.string().optional(),
            profileUrl: z.union([z.string().url(), z.literal(''), z.null()]).optional(),
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

exports.getMe = async (req, res, next) => {
    try {
        const affiliate = await prisma.affiliate.findFirst({ where: { userId: req.user.id } });
        if (!affiliate) throw new ApiError('Affiliate profile not found.', 404);
        res.json({ ok: true, data: { affiliate: fmtAffiliate(affiliate) } });
    } catch (err) { next(err); }
};

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
                totalEarned: affiliate.totalEarned / 100,
                totalPaid: affiliate.totalPaid / 100,
                balance: affiliate.balance / 100,
                payouts: affiliate.payouts.map(fmtPayout),
            },
        });
    } catch (err) { next(err); }
};

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

exports.adminList = async (req, res, next) => {
    try {
        const affiliates = await prisma.affiliate.findMany({
            orderBy: { createdAt: 'desc' },
            include: { payouts: { where: { status: 'PENDING' }, orderBy: { requestedAt: 'desc' } } },
        });
        res.json({
            ok: true,
            data: {
                affiliates: affiliates.map(a => ({
                    id: a.id, name: a.name, email: a.email, phone: a.phone,
                    location: a.location, channel: a.channel, audienceSize: a.audienceSize,
                    profileUrl: a.profileUrl, motivation: a.motivation,
                    bankAccount: a.bankAccount, bankName: a.bankName, accountName: a.accountName,
                    referralCode: a.referralCode, status: a.status.toLowerCase(),
                    totalClicks: a.totalClicks, totalReferrals: a.totalReferrals,
                    totalEarned: a.totalEarned / 100, totalPaid: a.totalPaid / 100, balance: a.balance / 100,
                    pendingPayouts: a.payouts.map(fmtPayout), createdAt: a.createdAt,
                })),
            },
        });
    } catch (err) { next(err); }
};

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

        // On approval: create account + send magic link email
        if (status === 'APPROVED') {
            issueAffiliateAccount(updated.id).catch(err => {
                console.error('[Affiliate] Account provisioning failed:', err.message);
            });
        }

        res.json({ ok: true, data: { affiliate: { id: updated.id, status: updated.status.toLowerCase() } } });
    } catch (err) { next(err); }
};

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
                data: { totalPaid: { increment: payout.amount }, balance: { decrement: payout.amount } },
            }),
        ]);
        res.json({ ok: true, data: { message: 'Payout marked as processed.' } });
    } catch (err) { next(err); }
};

// ─── Magic link: GET /auth/magic?token=xxx ────────────────────────────────────
exports.magicLogin = async (req, res, next) => {
    try {
        const { token } = req.query;
        if (!token) return res.status(400).json({ ok: false, error: 'Missing token.' });

        const record = magicTokenStore.get(token);
        if (!record || Date.now() > record.expiresAt) {
            return res.status(400).json({ ok: false, error: 'This link has expired. Please log in manually.' });
        }
        magicTokenStore.delete(token);

        const { generateAccessToken, generateRefreshToken, saveRefreshToken, setRefreshCookie } = require('../utils/jwt');
        const user = await prisma.user.findUnique({
            where: { id: record.userId },
            select: { id: true, name: true, email: true, phone: true, role: true, adminRole: true },
        });
        if (!user) return res.status(404).json({ ok: false, error: 'Account not found.' });

        const accessToken = generateAccessToken(user.id, user.role);
        const refreshToken = generateRefreshToken();
        await saveRefreshToken(user.id, refreshToken);
        setRefreshCookie(res, refreshToken);

        res.json({ ok: true, data: { user, accessToken, mustSetPassword: true } });
    } catch (err) { next(err); }
};

// ─── Internal: create account + magic link on affiliate approval ──────────────
async function issueAffiliateAccount(affiliateId) {
    const bcrypt = require('bcryptjs');
    const { sendEmail } = require('../services/email');
    const config = require('../config');

    const affiliate = await prisma.affiliate.findUnique({ where: { id: affiliateId } });
    if (!affiliate) return;

    let user = await prisma.user.findUnique({ where: { email: affiliate.email } });
    if (!user) {
        const tempHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 12);
        user = await prisma.user.create({
            data: {
                name: affiliate.name,
                email: affiliate.email,
                phone: affiliate.phone,
                passwordHash: tempHash,
                role: 'USER',
            },
        });
    }

    await prisma.affiliate.update({
        where: { id: affiliateId },
        data: { userId: user.id },
    });

    const token = crypto.randomBytes(32).toString('hex');
    magicTokenStore.set(token, { userId: user.id, expiresAt: Date.now() + 72 * 60 * 60 * 1000 });

    const magicUrl = `${config.frontendUrl}/dashboard.html?magic=${token}`;
    const firstName = affiliate.name.split(' ')[0];

    await sendEmail({
        to: affiliate.email,
        subject: 'You have been approved as a Jekafly Affiliate!',
        html: `<div style="font-family:'Poppins',sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(13,21,96,0.12);">
            <div style="background:linear-gradient(135deg,#0D1560,#1C2FBF);padding:36px 32px;text-align:center;">
                <img src="https://jekafly.com/assets/images/JEKAFLY%20LOGO%20W-R%202.png" style="height:38px;margin-bottom:16px;" alt="Jekafly" />
                <div style="background:rgba(255,255,255,0.15);border-radius:100px;display:inline-block;padding:8px 20px;font-size:0.82rem;font-weight:700;color:#fff;letter-spacing:0.05em;">AFFILIATE APPROVED</div>
            </div>
            <div style="padding:36px 32px;">
                <h2 style="color:#0D1560;font-size:1.4rem;font-weight:800;letter-spacing:-0.03em;margin:0 0 10px;">Welcome to the family, ${firstName}!</h2>
                <p style="color:#6B7280;font-size:0.9rem;line-height:1.7;margin-bottom:28px;">Your affiliate application has been approved. Click below to access your dashboard, get your unique referral link, and start earning.</p>
                <a href="${magicUrl}" style="display:block;text-align:center;padding:16px 28px;background:linear-gradient(135deg,#0D1560,#1C2FBF);color:#fff;border-radius:14px;font-size:1rem;font-weight:700;text-decoration:none;letter-spacing:-0.01em;box-shadow:0 6px 20px rgba(13,21,96,0.28);margin-bottom:16px;">Access My Affiliate Dashboard &rarr;</a>
                <p style="color:#9CA3AF;font-size:0.78rem;text-align:center;line-height:1.6;">This link expires in 72 hours. After that, simply log in at <a href="https://jekafly.com" style="color:#0D1560;">jekafly.com</a> with your email address.</p>
            </div>
            <div style="background:#F8F9FE;padding:20px 32px;border-top:1px solid #EEF0F8;">
                <p style="color:#9CA3AF;font-size:0.76rem;margin:0;text-align:center;">Questions? Contact us at <a href="mailto:support@jekafly.com" style="color:#0D1560;">support@jekafly.com</a></p>
            </div>
        </div>`,
    });
}

const fmtAffiliate = (a) => ({
    id: a.id, name: a.name, email: a.email, phone: a.phone,
    referralCode: a.referralCode, status: a.status.toLowerCase(),
    totalClicks: a.totalClicks, totalReferrals: a.totalReferrals,
    totalEarned: a.totalEarned / 100, totalPaid: a.totalPaid / 100, balance: a.balance / 100,
    createdAt: a.createdAt,
});

const fmtPayout = (p) => ({
    id: p.id, amount: p.amount / 100, status: p.status.toLowerCase(),
    bankName: p.bankName, accountNumber: p.accountNumber, accountName: p.accountName,
    note: p.note, requestedAt: p.requestedAt, processedAt: p.processedAt,
});