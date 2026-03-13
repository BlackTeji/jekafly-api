const { z } = require('zod');
const prisma = require('../utils/prisma');
const { ApiError } = require('../middleware/error');
const { emails } = require('../services/email');

// ─── GET /admin/applications ──────────────────────────────────────────────────
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

    // Compute stats
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

// ─── PATCH /admin/applications/:ref/status ────────────────────────────────────
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
        // Auto-mark as paid when approved or delivered
        ...((['APPROVED', 'DELIVERED'].includes(status)) && { paid: true }),
        // Stamp delivery timestamp for survey scheduling
        ...(status === 'DELIVERED' && { deliveredAt: new Date() }),
        statusHistory: { create: { status, note } },
      },
      include: { statusHistory: { orderBy: { createdAt: 'asc' } } },
    });

    // Notify applicant
    const user = await prisma.user.findUnique({
      where: { id: app.userId },
      select: { name: true, email: true },
    });
    if (user) await emails.statusUpdated(updated, note, user).catch(() => { });

    res.json({ ok: true, data: { application: fmt(updated) } });
  } catch (err) { next(err); }
};

// ─── GET /admin/users ─────────────────────────────────────────────────────────
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
          id: true, name: true, email: true, phone: true, role: true, createdAt: true,
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

// ─── PATCH /admin/users/:id/role ──────────────────────────────────────────────
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

// ─── GET /admin/documents ─────────────────────────────────────────────────────
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

// ─── GET /admin/applications/:ref ─────────────────────────────────────────────
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

// ─── DELETE /admin/users/:id ──────────────────────────────────────────────────
exports.deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Prevent deleting any admin account
    if (id === req.user.id) {
      return res.status(400).json({ ok: false, error: 'You cannot delete your own admin account.' });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ ok: false, error: 'User not found.' });
    if (user.role === 'ADMIN') return res.status(400).json({ ok: false, error: 'Admin accounts cannot be deleted.' });
    if (user.deletedAt) return res.status(400).json({ ok: false, error: 'User is already deleted.' });

    const now = new Date();

    // Archive all their applications — stamp deletedAt + preserve userId reference
    await prisma.application.updateMany({
      where: { userId: id },
      data: { deletedAt: now, archivedUserId: id },
    });

    // Soft-delete the user — anonymise PII but keep the record
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

    // Hard-delete refresh tokens and documents (S3 keys stay, objects expire naturally)
    await prisma.refreshToken.deleteMany({ where: { userId: id } });

    res.json({ ok: true, data: { message: 'User deleted and data archived.' } });
  } catch (err) { next(err); }
};