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

        const surveyUrl = `${frontendUrl}/survey?token=${token}`;

        await sendEmail({
            to: app.user.email,
            subject: `${displayName}, how was your ${app.destination} trip?`,
            html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jekafly</title></head>
<body style="margin:0;padding:0;background:#F0F2F8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F2F8;padding:40px 0;">
    <tr><td align="center" style="padding:0 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">
        <tr>
          <td style="background:linear-gradient(135deg,#0D1560 0%,#1C2FBF 100%);padding:32px 40px;border-radius:16px 16px 0 0;text-align:center;position:relative;overflow:hidden;">
            <img src="https://jekafly.com/assets/images/JEKAFLY%20LOGO%20W-R%202.png" alt="Jekafly" width="148" style="display:block;margin:0 auto 24px;max-width:148px;height:auto;" />
            <div style="display:inline-block;background:rgba(255,255,255,0.12);border:1px solid rgba(255,255,255,0.2);border-radius:100px;padding:6px 18px;font-size:11px;font-weight:700;color:rgba(255,255,255,0.9);letter-spacing:0.1em;text-transform:uppercase;margin-bottom:16px;">Visa Delivered</div>
            <h1 style="margin:0 0 8px;font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.03em;line-height:1.2;">${app.destination} — Done. ✈️</h1>
            <p style="margin:0;font-size:15px;color:rgba(255,255,255,0.65);line-height:1.6;">Congratulations on your upcoming journey</p>
          </td>
        </tr>
        <tr><td style="background:#E31E24;height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>
        <tr>
          <td style="background:#ffffff;padding:44px 40px 36px;border-radius:0 0 16px 16px;">
            <p style="margin:0 0 20px;font-size:16px;color:#111827;font-weight:700;">Hi ${displayName},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#4B5563;line-height:1.75;">Your <strong style="color:#0D1560;">${app.destination} visa</strong> has been delivered. We hope your trip is everything you planned for.</p>
            <p style="margin:0 0 32px;font-size:15px;color:#4B5563;line-height:1.75;">Before you go — would you share a few words about your experience with Jekafly? It takes under a minute, and it helps thousands of Nigerians plan their own journeys with confidence.</p>
            <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
              <tr>
                <td style="border-radius:12px;background:linear-gradient(135deg,#0D1560 0%,#1C2FBF 100%);box-shadow:0 6px 24px rgba(13,21,96,0.3);">
                  <a href="${surveyUrl}" style="display:inline-block;padding:17px 44px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:-0.01em;border-radius:12px;">Share My Experience →</a>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F9FE;border-radius:10px;border:1px solid #EAECF4;margin-bottom:28px;">
              <tr>
                <td style="padding:11px 18px;font-size:13px;color:#6B7280;border-bottom:1px solid #F3F4F8;white-space:nowrap;width:40%;">Destination</td>
                <td style="padding:11px 18px;font-size:13px;color:#111827;font-weight:600;border-bottom:1px solid #F3F4F8;">${app.destination}</td>
              </tr>
              <tr>
                <td style="padding:11px 18px;font-size:13px;color:#6B7280;white-space:nowrap;">Reference</td>
                <td style="padding:11px 18px;font-size:13px;color:#111827;font-weight:600;font-family:monospace;letter-spacing:0.04em;">${app.ref}</td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:36px;border-top:1px solid #EAECF4;">
              <tr><td style="padding-top:24px;text-align:center;">
                <p style="margin:0 0 6px;font-size:12px;color:#9BA5C0;">© ${new Date().getFullYear()} Jekafly. All rights reserved.</p>
                <p style="margin:0;font-size:12px;color:#9BA5C0;">
                  <a href="mailto:support@jekafly.com" style="color:#0D1560;text-decoration:none;font-weight:600;">support@jekafly.com</a>
                  &nbsp;·&nbsp;
                  <a href="https://jekafly.com" style="color:#0D1560;text-decoration:none;font-weight:600;">jekafly.com</a>
                </p>
              </td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
        }).catch(err => console.error(`Survey email failed for ${app.ref}:`, err));
    }

    if (apps.length > 0) console.log(`📧 Sent ${apps.length} survey email(s)`);
};