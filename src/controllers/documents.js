const prisma = require('../utils/prisma');
const { ApiError } = require('../middleware/error');
const { getSignedDownloadUrl, deleteFile } = require('../services/storage');
const { sendEmail } = require('../services/email');
const config = require('../config');

// ─── POST /documents/upload ───────────────────────────────────────────────────
exports.upload = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      throw new ApiError('No files uploaded.', 400);
    }

    const { ref, docIndex } = req.body;
    let applicationId = null;
    let application = null;

    if (ref) {
      application = await prisma.application.findUnique({ where: { ref } });
      if (!application) throw new ApiError('Application not found.', 404);
      if (application.userId !== req.user.id && req.user.role !== 'ADMIN') {
        throw new ApiError('Not authorised.', 403);
      }
      applicationId = application.id;
    }

    const docs = await Promise.all(req.files.map((file, i) =>
      prisma.document.create({
        data: {
          userId: req.user.id,
          applicationId,
          name: file.originalname,
          key: file.key,
          mimeType: file.mimetype,
          size: file.size,
          docIndex: docIndex != null ? parseInt(docIndex) + i : null,
        },
      })
    ));

    if (applicationId) {
      const app = await prisma.application.findUnique({
        where: { id: applicationId },
      });
      if (app && app.status === 'RECEIVED') {
        await prisma.application.update({
          where: { id: applicationId },
          data: { status: 'PROCESSING' },
        });
        await prisma.statusHistory.create({
          data: {
            applicationId,
            status: 'PROCESSING',
            note: 'Documents submitted — under expert review.',
          },
        });
      }
    }

    const uploaded = await Promise.all(docs.map(async (doc) => ({
      id: doc.id,
      name: doc.name,
      mimeType: doc.mimeType,
      size: doc.size,
      docIndex: doc.docIndex,
      uploadedAt: doc.uploadedAt,
      url: await getSignedDownloadUrl(doc.key),
    })));

    // ── Email trigger ─────────────────────────────────────────────────────────
    if (applicationId && application) {
      const uploader = await prisma.user.findUnique({ where: { id: req.user.id } });
      const fileList = docs.map(d => `<li style="margin:4px 0;font-size:13px;color:#374151;">${d.name}</li>`).join('');
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@jekafly.com';

      sendEmail({
        to: adminEmail,
        subject: `Documents Uploaded — ${application.ref}`,
        html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jekafly</title></head>
<body style="margin:0;padding:0;background:#F0F2F8;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F0F2F8;padding:40px 0;">
    <tr><td align="center" style="padding:0 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;">
        <tr>
          <td style="background:linear-gradient(135deg,#0D1560 0%,#1C2FBF 100%);padding:32px 40px;border-radius:16px 16px 0 0;text-align:center;">
            <img src="https://jekafly.com/assets/images/JEKAFLY%20LOGO%20W-R%202.png" alt="Jekafly" width="148" style="display:block;margin:0 auto;max-width:148px;height:auto;" />
          </td>
        </tr>
        <tr><td style="background:#E31E24;height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>
        <tr>
          <td style="background:#ffffff;padding:44px 40px 36px;border-radius:0 0 16px 16px;">
            <div style="display:inline-block;background:rgba(13,21,96,0.06);border:1px solid rgba(13,21,96,0.12);border-radius:100px;padding:6px 16px;font-size:11px;font-weight:700;color:#0D1560;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:20px;">Documents Uploaded</div>
            <h1 style="margin:0 0 10px;font-size:26px;font-weight:800;color:#0D1560;letter-spacing:-0.03em;line-height:1.2;">📎 New documents received.</h1>
            <p style="margin:0 0 24px;font-size:15px;color:#4B5563;line-height:1.7;">
              <strong>${uploader?.name || req.user.email}</strong> has uploaded ${docs.length} document${docs.length > 1 ? 's' : ''} for application <strong style="color:#0D1560;">${application.ref}</strong> (${application.destination || 'Unknown'}).
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F9FE;border-radius:10px;margin:20px 0;overflow:hidden;border:1px solid #EAECF4;">
              <tr><td style="padding:11px 18px;font-size:13px;color:#6B7280;border-bottom:1px solid #F3F4F8;width:40%;white-space:nowrap;">Reference</td><td style="padding:11px 18px;font-size:13px;color:#111827;font-weight:600;border-bottom:1px solid #F3F4F8;font-family:monospace;">${application.ref}</td></tr>
              <tr><td style="padding:11px 18px;font-size:13px;color:#6B7280;border-bottom:1px solid #F3F4F8;white-space:nowrap;">Destination</td><td style="padding:11px 18px;font-size:13px;color:#111827;font-weight:600;border-bottom:1px solid #F3F4F8;">${application.destination || '—'}</td></tr>
              <tr><td style="padding:11px 18px;font-size:13px;color:#6B7280;border-bottom:1px solid #F3F4F8;white-space:nowrap;">Uploaded by</td><td style="padding:11px 18px;font-size:13px;color:#111827;font-weight:600;border-bottom:1px solid #F3F4F8;">${uploader?.name || '—'} &lt;${uploader?.email || req.user.email}&gt;</td></tr>
              <tr><td style="padding:11px 18px;font-size:13px;color:#6B7280;white-space:nowrap;">Files (${docs.length})</td><td style="padding:11px 18px;"><ul style="margin:0;padding:0 0 0 16px;">${fileList}</ul></td></tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;">
              <tr>
                <td style="background:#F8F9FE;border-left:3px solid #0D1560;border-radius:0 10px 10px 0;padding:16px 20px;font-size:14px;color:#374151;line-height:1.65;">
                  📋 Please log in to the admin panel to review and download these documents.
                </td>
              </tr>
            </table>
            <table cellpadding="0" cellspacing="0" style="margin:32px auto 8px;">
              <tr>
                <td style="border-radius:10px;background:linear-gradient(135deg,#0D1560 0%,#1C2FBF 100%);box-shadow:0 4px 16px rgba(13,21,96,0.28);">
                  <a href="${config.frontendUrl}/admin" style="display:inline-block;padding:15px 36px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:-0.01em;border-radius:10px;">Review in Admin Panel →</a>
                </td>
              </tr>
            </table>
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:36px;border-top:1px solid #EAECF4;">
              <tr><td style="padding-top:24px;text-align:center;">
                <p style="margin:0 0 6px;font-size:12px;color:#9BA5C0;">© ${new Date().getFullYear()} Jekafly. All rights reserved.</p>
                <p style="margin:0;font-size:12px;color:#9BA5C0;">
                  <a href="mailto:support@jekafly.com" style="color:#0D1560;text-decoration:none;font-weight:600;">support@jekafly.com</a>
                  &nbsp;·&nbsp;
                  <a href="${config.frontendUrl}" style="color:#0D1560;text-decoration:none;font-weight:600;">jekafly.com</a>
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
      }).catch(err => console.error('[Email] Document upload notification failed:', err.message));
    }

    res.status(201).json({ ok: true, data: { uploaded } });
  } catch (err) { next(err); }
};

// ─── GET /documents ───────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;
    const where = {};

    if (req.query.ref) {
      const app = await prisma.application.findUnique({ where: { ref: req.query.ref } });
      if (app) {
        if (req.user.role !== 'ADMIN' && app.userId !== req.user.id) {
          return res.status(403).json({ ok: false, error: 'Not authorised.' });
        }
        where.applicationId = app.id;
      }
    } else {
      where.userId = req.user.id;
    }

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where, skip, take: limit,
        orderBy: { uploadedAt: 'desc' },
        include: { application: { select: { ref: true } } },
      }),
      prisma.document.count({ where }),
    ]);

    const docsWithUrls = documents.map((d) => ({
      id: d.id,
      name: d.name,
      mimeType: d.mimeType,
      size: d.size,
      docIndex: d.docIndex,
      ref: d.application?.ref || null,
      uploadedAt: d.uploadedAt,
    }));

    res.json({ ok: true, data: { documents: docsWithUrls, total, page, limit } });
  } catch (err) { next(err); }
};

// ─── GET /documents/:id/url ───────────────────────────────────────────────────
exports.getSignedUrl = async (req, res, next) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) throw new ApiError('Document not found.', 404);
    if (doc.userId !== req.user.id && req.user.role !== 'ADMIN') {
      throw new ApiError('Not authorised.', 403);
    }

    const expiresIn = 3600;
    const url = await getSignedDownloadUrl(doc.key, expiresIn);
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    res.json({ ok: true, data: { url, expiresAt } });
  } catch (err) { next(err); }
};

// ─── DELETE /documents/:id ────────────────────────────────────────────────────
exports.remove = async (req, res, next) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) throw new ApiError('Document not found.', 404);
    if (doc.userId !== req.user.id && req.user.role !== 'ADMIN') {
      throw new ApiError('Not authorised.', 403);
    }

    await deleteFile(doc.key);
    await prisma.document.delete({ where: { id: req.params.id } });

    res.json({ ok: true, data: { message: 'Document deleted.' } });
  } catch (err) { next(err); }
};