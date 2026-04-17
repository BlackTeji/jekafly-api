const prisma = require('../utils/prisma');
const crypto = require('crypto');
const { ApiError } = require('../middleware/error');
const { z } = require('zod');

// ─── GET /reviews (public — approved only) ────────────────────────────────────
exports.listApproved = async (req, res, next) => {
    try {
        const reviews = await prisma.review.findMany({
            where: { approved: true },
            orderBy: { createdAt: 'desc' },
            take: 50,
            select: { id: true, name: true, destination: true, rating: true, text: true, createdAt: true },
        });
        res.json({ ok: true, data: { reviews } });
    } catch (err) { next(err); }
};

// ─── GET /reviews/survey/:token (public — validate token) ─────────────────────
exports.getSurvey = async (req, res, next) => {
    try {
        const review = await prisma.review.findUnique({
            where: { surveyToken: req.params.token },
        });
        if (!review) return res.status(404).json({ ok: false, error: 'Survey link not found.' });
        if (review.surveyUsed) return res.status(410).json({ ok: false, error: 'This survey link has already been used.' });
        res.json({ ok: true, data: { destination: review.destination, name: review.name } });
    } catch (err) { next(err); }
};

// ─── POST /reviews/survey/:token (public — submit review) ────────────────────
exports.submitSurvey = async (req, res, next) => {
    try {
        const schema = z.object({
            rating: z.number().int().min(1).max(5),
            text: z.string().min(10, 'Please write at least 10 characters.').max(600),
            name: z.string().min(1).max(80).optional(),
        });
        const { rating, text, name } = schema.parse(req.body);

        const review = await prisma.review.findUnique({
            where: { surveyToken: req.params.token },
        });
        if (!review) return res.status(404).json({ ok: false, error: 'Survey link not found.' });
        if (review.surveyUsed) return res.status(410).json({ ok: false, error: 'This survey has already been submitted.' });

        await prisma.review.update({
            where: { surveyToken: req.params.token },
            data: {
                rating,
                text,
                name: name || review.name,
                surveyUsed: true,
            },
        });

        res.json({ ok: true, data: { message: 'Thank you for your review!' } });
    } catch (err) { next(err); }
};

// ─── GET /admin/reviews ───────────────────────────────────────────────────────
exports.adminList = async (req, res, next) => {
    try {
        const reviews = await prisma.review.findMany({
            where: { surveyUsed: true },
            orderBy: { createdAt: 'desc' },
        });
        res.json({ ok: true, data: { reviews } });
    } catch (err) { next(err); }
};

// ─── PATCH /admin/reviews/:id ─────────────────────────────────────────────────
exports.adminUpdate = async (req, res, next) => {
    try {
        const schema = z.object({ approved: z.boolean() });
        const { approved } = schema.parse(req.body);
        const review = await prisma.review.update({
            where: { id: req.params.id },
            data: { approved },
        });
        res.json({ ok: true, data: { review } });
    } catch (err) { next(err); }
};

// ─── DELETE /admin/reviews/:id ────────────────────────────────────────────────
exports.adminDelete = async (req, res, next) => {
    try {
        await prisma.review.delete({ where: { id: req.params.id } });
        res.json({ ok: true, data: { message: 'Review deleted.' } });
    } catch (err) { next(err); }
};

// ─── Survey scheduler — call this on a cron/interval ─────────────────────────
exports.sendPendingSurveys = async () => {
    const { sendEmail, emails } = require('../services/email');
    const config = require('../config');
    const frontendUrl = config.frontendUrl || process.env.FRONTEND_URL || 'https://jekafly-frontend-verz.vercel.app';

    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Find DELIVERED apps where deliveredAt was 2-7 days ago, no survey sent yet
    const apps = await prisma.application.findMany({
        where: {
            status: 'DELIVERED',
            deletedAt: null,
            deliveredAt: { gte: sevenDaysAgo, lte: twoDaysAgo },
            review: null, // no review record created yet
        },
        include: {
            user: { select: { name: true, email: true, deletedAt: true } },
        },
    });

    for (const app of apps) {
        if (!app.user || app.user.deletedAt) continue;

        const token = crypto.randomBytes(32).toString('hex');
        const displayName = (app.user.name || 'Traveller').split(' ')[0];

        // Create the review record (empty until survey is filled)
        await prisma.review.create({
            data: {
                applicationRef: app.ref,
                userId: app.userId,
                name: displayName,
                destination: app.destination,
                rating: 5, // placeholder — overwritten on submit
                text: '', // placeholder
                surveyToken: token,
                surveysentAt: new Date(),
            },
        });

        const surveyUrl = `${frontendUrl}/survey?token=${token}`;

        await emails.surveyRequest(app, displayName, surveyUrl)
            .catch(err => console.error(`Survey email failed for ${app.ref}:`, err));
    }

    if (apps.length > 0) console.log(`📧 Sent ${apps.length} survey email(s)`);
};