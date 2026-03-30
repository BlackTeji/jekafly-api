const { z } = require('zod');
const prisma = require('../utils/prisma');
const { ApiError } = require('../middleware/error');
const { emails } = require('../services/email');

exports.listApplications = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;
    const where = {};

    if (req.query.status) {
      where.status = req.query.status.toUpperCase();
    }
    if (req.query.q) {
      const q = req.query.q.toLowerCase();
      where.OR = [
        { ref: { contains: q, mode: 'insensitive' } },
        { applicantName: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { destination: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [applications, total] = await Promise.all([
      prisma.application.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: { statusHistory: { orderBy: { createdAt: 'asc' } } },
      }),
      prisma.application.count({ where }),
    ]);

    const all = await prisma.application.findMany({
      select: { status: true, paid: true, fee: true },
    });
    const stats = {
      total: all.length,
      pending: all.filter(a => ['RECEIVED', 'PROCESSING', 'EMBASSY'].includes(a.status)).length,
      approved: all.filter(a => ['APPROVED', 'DELIVERED'].includes(a.status)).length,
      revenue: all.filter(a => a.paid).reduce((s, a) => s + a.fee, 0) / 100,
    };

    res.json({ ok: true, data: { applications: applications.map(fmt), total, page, limit, stats } });
  } catch (err) { next(err); }
};

exports.updateStatus = async (req, res, next) => {
  try {
    const schema = z.object({
      status: z.enum(['RECEIVED', 'PROCESSING', 'EMBASSY', 'APPROVED', 'DELIVERED', 'REJECTED']),
      note: z.string().min(1),
    });
    const { status, note } = schema.parse(req.body);

    const app = await prisma.application.findUnique({ where: { ref: req.params.ref } });
    if (!app) throw new ApiError('Application not found.', 404);

    const updated = await prisma.application.update({
      where: { ref: req.params.ref },
      data: {
        status,
        ...((['APPROVED', 'DELIVERED'].includes(status)) && { paid: true }),
        ...(status === 'DELIVERED' && { deliveredAt: new Date() }),
        statusHistory: { create: { status, note } },
      },
      include: { statusHistory: { orderBy: { createdAt: 'asc' } } },
    });

    const user = await prisma.user.findUnique({
      where: { id: app.userId },
      select: { name: true, email: true },
    });
    if (user) await emails.statusUpdated(updated, note, user).catch(() => { });

    res.json({ ok: true, data: { application: fmt(updated) } });
  } catch (err) { next(err); }
};

exports.listUsers = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip = (page - 1) * limit;
    const baseWhere = { deletedAt: null };
    const where = req.query.role
      ? { ...baseWhere, role: req.query.role.toUpperCase() }
      : baseWhere;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, email: true, phone: true, role: true, adminRole: true, createdAt: true,
          _count: { select: { applications: true } }
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({
      ok: true,
      data: {
        users: users.map(u => ({ ...u, applicationCount: u._count.applications, _count: undefined })),
        total, page, limit,
      }
    });
  } catch (err) { next(err); }
};

exports.updateRole = async (req, res, next) => {
  try {
    const { role } = z.object({ role: z.enum(['USER', 'ADMIN']) }).parse(req.body);
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { role },
      select: { id: true, name: true, email: true, role: true },
    });
    res.json({ ok: true, data: { user } });
  } catch (err) { next(err); }
};

const fmt = (app) => ({
  ...app,
  fee: app.fee / 100,
  status: app.status.toLowerCase(),
  statusHistory: (app.statusHistory || []).map(h => ({
    status: h.status.toLowerCase(), note: h.note, date: h.createdAt,
  })),
});

exports.listDocuments = async (req, res, next) => {
  try {
    const ref = req.query.ref;
    const userId = req.query.userId;
    const where = {};
    if (ref) {
      const app = await require('../utils/prisma').application.findUnique({ where: { ref } });
      if (app) where.applicationId = app.id;
    }
    if (userId) where.userId = userId;

    const prisma = require('../utils/prisma');
    const docs = await prisma.document.findMany({
      where,
      orderBy: { uploadedAt: 'desc' },
      include: {
        user: { select: { name: true, email: true } },
        application: { select: { ref: true } },
      },
    });

    const docsWithUrls = docs.map((d) => ({
      id: d.id,
      name: d.name,
      mimeType: d.mimeType,
      size: d.size,
      ref: d.application?.ref || null,
      uploadedBy: d.user?.name || d.user?.email || 'Unknown',
      uploadedAt: d.uploadedAt,
    }));

    res.json({ ok: true, data: { documents: docsWithUrls } });
  } catch (err) { next(err); }
};

exports.getApplication = async (req, res, next) => {
  try {
    const prisma = require('../utils/prisma');
    const app = await prisma.application.findUnique({
      where: { ref: req.params.ref },
      include: {
        statusHistory: { orderBy: { createdAt: 'asc' } },
        documents: {
          select: { id: true, name: true, mimeType: true, size: true, uploadedAt: true, docIndex: true },
        },
        user: { select: { name: true, email: true, phone: true } },
      },
    });
    if (!app) throw new (require('../middleware/error').ApiError)('Application not found.', 404);

    res.json({
      ok: true,
      data: {
        application: {
          ...app,
          fee: app.fee / 100,
          status: app.status.toLowerCase(),
          statusHistory: (app.statusHistory || []).map(h => ({
            status: h.status.toLowerCase(),
            note: h.note,
            date: h.createdAt,
          })),
        },
      },
    });
  } catch (err) { next(err); }
};

exports.deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (id === req.user.id) {
      return res.status(400).json({ ok: false, error: 'You cannot delete your own admin account.' });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });
    if (user.role === 'ADMIN') return res.status(400).json({ ok: false, error: 'Admin accounts cannot be deleted.' });
    if (user.deletedAt) return res.status(400).json({ ok: false, error: 'User is already deleted.' });

    const now = new Date();

    await prisma.application.updateMany({
      where: { userId: id },
      data: { deletedAt: now, archivedUserId: id },
    });

    await prisma.user.update({
      where: { id },
      data: {
        name: '[Deleted User]',
        email: `deleted-${id}@jekafly.invalid`,
        phone: null,
        passwordHash: 'DELETED',
        deletedAt: now,
      },
    });

    await prisma.refreshToken.deleteMany({ where: { userId: id } });

    res.json({ ok: true, data: { message: 'User deleted and data archived.' } });
  } catch (err) { next(err); }
};

exports.updateAdminRole = async (req, res, next) => {
  try {
    const { z } = require('zod');
    const { adminRole } = z.object({
      adminRole: z.enum(['super', 'applications', 'finance', 'consultations', 'affiliates']),
    }).parse(req.body);

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ ok: false, error: 'User not found.' });
    if (target.role !== 'ADMIN') return res.status(400).json({ ok: false, error: 'User is not an admin.' });

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { adminRole },
      select: { id: true, name: true, email: true, role: true, adminRole: true },
    });

    res.json({ ok: true, data: { user } });
  } catch (err) { next(err); }
};

exports.listFlightBookings = async (req, res, next) => {
  try {
    res.json({ ok: true, data: { bookings: [], total: 0 } });
  } catch (err) { next(err); }
};

exports.listHotelBookings = async (req, res, next) => {
  try {
    res.json({ ok: true, data: { bookings: [], total: 0 } });
  } catch (err) { next(err); }
};

exports.streamDocument = async (req, res, next) => {
  try {
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const config = require('../config');

    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!doc) return res.status(404).json({ ok: false, error: 'Document not found.' });
    if (!doc.key || doc.key.startsWith('local/')) {
      return res.status(400).json({ ok: false, error: 'Document not available for streaming.' });
    }

    const s3 = new S3Client({
      region: config.aws.region,
      credentials: { accessKeyId: config.aws.accessKeyId, secretAccessKey: config.aws.secretAccessKey },
    });

    const { Body, ContentType, ContentLength } = await s3.send(
      new GetObjectCommand({ Bucket: config.aws.bucket, Key: doc.key })
    );

    const disposition = req.query.download === '1'
      ? `attachment; filename="${encodeURIComponent(doc.name)}"`
      : `inline; filename="${encodeURIComponent(doc.name)}"`;

    res.setHeader('Content-Type', ContentType || doc.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', disposition);
    res.setHeader('Cache-Control', 'private, max-age=300');
    if (ContentLength) res.setHeader('Content-Length', ContentLength);

    Body.pipe(res);
  } catch (err) { next(err); }
};

exports.downloadDocumentsZip = async (req, res, next) => {
  try {
    const { ref } = req.query;
    if (!ref) return res.status(400).json({ ok: false, error: 'ref query parameter is required.' });

    const archiver = require('archiver');
    const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
    const config = require('../config');

    const app = await prisma.application.findUnique({ where: { ref } });
    if (!app) return res.status(404).json({ ok: false, error: 'Application not found.' });

    const docs = await prisma.document.findMany({
      where: { applicationId: app.id },
      orderBy: { uploadedAt: 'asc' },
    });

    if (!docs.length) return res.status(404).json({ ok: false, error: 'No documents found.' });

    const s3 = new S3Client({
      region: config.aws.region,
      credentials: { accessKeyId: config.aws.accessKeyId, secretAccessKey: config.aws.secretAccessKey },
    });

    const archive = archiver('zip', { zlib: { level: 6 } });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${ref}-documents.zip"`);
    res.setHeader('Cache-Control', 'no-store');

    archive.on('error', (err) => {
      if (!res.headersSent) res.status(500).json({ ok: false, error: 'ZIP generation failed.' });
      else res.destroy();
    });

    archive.pipe(res);

    for (const doc of docs) {
      if (!doc.key || doc.key.startsWith('local/')) continue;
      try {
        const { Body } = await s3.send(new GetObjectCommand({ Bucket: config.aws.bucket, Key: doc.key }));
        archive.append(Body, { name: doc.name || `document-${doc.id}` });
      } catch (err) {
        console.error(`[ZIP] Skipping doc ${doc.id}:`, err.message);
      }
    }

    await archive.finalize();
  } catch (err) { next(err); }
};