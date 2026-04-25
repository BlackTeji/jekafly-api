const path = require('path');
const prisma = require('../utils/prisma');
const { ApiError } = require('../middleware/error');
const { getSignedDownloadUrl, deleteFile } = require('../services/storage');
const { sendEmail } = require('../services/email');
const config = require('../config');

const sanitizeFilename = (name) =>
  path.basename(String(name || 'document')).replace(/[^a-zA-Z0-9._\-\s]/g, '_').slice(0, 200) || 'document';

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
          name: sanitizeFilename(file.originalname),
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

    if (applicationId && application) {
      const uploader = await prisma.user.findUnique({ where: { id: req.user.id } });
      const fileList = docs.map(d => `<li style="margin:4px 0;font-size:13px;color:#374151;">${d.name}</li>`).join('');
      const adminEmail = process.env.ADMIN_EMAIL || 'jekaflynigeria@gmail.com';

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
            <h1 style="margin:0 0 10px;font-size:26px;font-weight:800;color:#0D1560;">📎 New documents received.</h1>
            <p style="margin:0 0 24px;font-size:15px;color:#4B5563;line-height:1.7;">
              <strong>${uploader?.name || req.user.email}</strong> uploaded ${docs.length} document${docs.length > 1 ? 's' : ''} for <strong>${application.ref}</strong>.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F9FE;border-radius:10px;margin:20px 0;overflow:hidden;border:1px solid #EAECF4;">
              <tr><td style="padding:11px 18px;font-size:13px;color:#6B7280;border-bottom:1px solid #F3F4F8;width:40%;">Reference</td><td style="padding:11px 18px;font-size:13px;color:#111827;font-weight:600;border-bottom:1px solid #F3F4F8;font-family:monospace;">${application.ref}</td></tr>
              <tr><td style="padding:11px 18px;font-size:13px;color:#6B7280;border-bottom:1px solid #F3F4F8;">Destination</td><td style="padding:11px 18px;font-size:13px;color:#111827;font-weight:600;border-bottom:1px solid #F3F4F8;">${application.destination || '—'}</td></tr>
              <tr><td style="padding:11px 18px;font-size:13px;color:#6B7280;">Files (${docs.length})</td><td style="padding:11px 18px;"><ul style="margin:0;padding:0 0 0 16px;">${fileList}</ul></td></tr>
            </table>
            <table cellpadding="0" cellspacing="0" style="margin:32px auto 8px;">
              <tr>
                <td style="border-radius:10px;background:linear-gradient(135deg,#0D1560 0%,#1C2FBF 100%);">
                  <a href="${config.frontendUrl}/admin" style="display:inline-block;padding:15px 36px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">Review in Admin Panel →</a>
                </td>
              </tr>
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