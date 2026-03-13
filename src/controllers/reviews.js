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
    const { sendEmail } = require('../services/email');
    const frontendUrl = process.env.FRONTEND_URL || 'https://jekafly-frontend-verz.vercel.app';

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

        const surveyUrl = `${frontendUrl}/survey.html?token=${token}`;

        await sendEmail({
            to: app.user.email,
            subject: `How was your ${app.destination} visa experience? 🌍`,
            html: `
      <div style="font-family:'Plus Jakarta Sans',sans-serif;max-width:520px;margin:0 auto;background:#f7f8fc;border-radius:16px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#0a1f44,#0d2d6b);padding:32px 32px 24px;text-align:center;">
          <img src="${frontendUrl}/assets/images/JEKAFLY%20LOGO%20B-R%202.png" style="height:36px;margin-bottom:20px;" />
          <h2 style="color:#fff;font-size:1.4rem;margin:0 0 8px;">Your visa was delivered! 🎉</h2>
          <p style="color:rgba(255,255,255,0.7);font-size:0.9rem;margin:0;">We'd love to hear about your experience</p>
        </div>
        <div style="padding:28px 32px;">
          <p style="color:#374151;font-size:0.95rem;line-height:1.7;margin-bottom:20px;">
            Hi <strong>${displayName}</strong>,<br><br>
            Your <strong>${app.destination} visa</strong> has been delivered — congratulations on your upcoming trip! 🌍<br><br>
            It would mean a lot to us if you took 60 seconds to share your experience. Your feedback helps other Nigerians make informed decisions.
          </p>
          <div style="text-align:center;margin:28px 0;">
            <a href="${surveyUrl}" style="display:inline-block;background:linear-gradient(135deg,#e8613a,#c04e2a);color:#fff;text-decoration:none;padding:16px 36px;border-radius:12px;font-weight:700;font-size:1rem;">
              ⭐ Rate Your Experience
            </a>
          </div>
          <p style="color:#9ca3af;font-size:0.78rem;text-align:center;line-height:1.6;">
            This link is unique to your application and can only be used once.<br>
            Ref: ${app.ref}
          </p>
        </div>
      </div>`,
        }).catch(err => console.error(`Survey email failed for ${app.ref}:`, err));
    }

    if (apps.length > 0) console.log(`📧 Sent ${apps.length} survey email(s)`);
};