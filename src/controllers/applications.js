const { z } = require('zod');
const prisma = require('../utils/prisma');
const { ApiError } = require('../middleware/error');
const { generateRef } = require('../utils/ref');
const { emails } = require('../services/email');

const appSchema = z.object({
  destination:    z.string().min(1),
  purpose:        z.string().min(1),
  visaType:       z.string().optional(),
  travelDate:     z.string().optional(),
  returnDate:     z.string().optional(),
  applicantName:  z.string().min(1),
  email:          z.string().email(),
  phone:          z.string().optional(),
  nationality:    z.string().optional(),
  passportNumber: z.string().optional(),
  passportExpiry: z.string().optional(),
  dob:            z.string().optional(),
  travellers:     z.array(z.any()).optional(),
  feeBreakdown:   z.any().optional(),
  fee:            z.number().optional(),
});

const toDate = (s) => s ? new Date(s) : undefined;

// ─── POST /applications ───────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const data = appSchema.parse(req.body);
    const ref = await generateRef();

    const app = await prisma.application.create({
      data: {
        ref,
        userId:         req.user.id,
        destination:    data.destination,
        purpose:        data.purpose,
        visaType:       data.visaType,
        travelDate:     toDate(data.travelDate),
        returnDate:     toDate(data.returnDate),
        applicantName:  data.applicantName,
        email:          data.email,
        phone:          data.phone,
        nationality:    data.nationality,
        passportNumber: data.passportNumber,
        passportExpiry: toDate(data.passportExpiry),
        dob:            toDate(data.dob),
        travellers:     data.travellers || [],
        feeBreakdown:   data.feeBreakdown,
        fee:            data.fee ? Math.round(data.fee * 100) : 0, // store in kobo
        status:         'RECEIVED',
        statusHistory: {
          create: {
            status: 'RECEIVED',
            note: 'Application received and under review.',
          }
        }
      },
      include: { statusHistory: true },
    });

    await emails.applicationConfirmed(app, req.user).catch(() => {});

    res.status(201).json({ ok: true, data: { application: formatApp(app) } });
  } catch (err) { next(err); }
};

// ─── GET /applications ────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 20);
    const skip  = (page - 1) * limit;
    const where = { userId: req.user.id };
    if (req.query.status) where.status = req.query.status.toUpperCase();

    const [applications, total] = await Promise.all([
      prisma.application.findMany({
        where, skip, take: limit,
        orderBy: { createdAt: 'desc' },
        include: { statusHistory: { orderBy: { createdAt: 'asc' } } },
      }),
      prisma.application.count({ where }),
    ]);

    res.json({ ok: true, data: { applications: applications.map(formatApp), total, page, limit } });
  } catch (err) { next(err); }
};

// ─── GET /applications/:ref ───────────────────────────────────────────────────
exports.getOne = async (req, res, next) => {
  try {
    const app = await prisma.application.findUnique({
      where: { ref: req.params.ref },
      include: {
        statusHistory: { orderBy: { createdAt: 'asc' } },
        documents: { select: { id: true, name: true, mimeType: true, size: true, uploadedAt: true, docIndex: true } },
      },
    });
    if (!app) throw new ApiError('Application not found.', 404);

    // Users can only see their own; admins see all
    if (req.user.role !== 'ADMIN' && app.userId !== req.user.id) {
      throw new ApiError('Application not found.', 404);
    }

    res.json({ ok: true, data: { application: formatApp(app) } });
  } catch (err) { next(err); }
};

// ─── GET /applications/track/:ref (public) ────────────────────────────────────
exports.track = async (req, res, next) => {
  try {
    const app = await prisma.application.findUnique({
      where: { ref: req.params.ref },
      include: { statusHistory: { orderBy: { createdAt: 'asc' } } },
    });
    if (!app) throw new ApiError('No application found with that reference.', 404);

    // Return limited fields only — no personal data
    res.json({
      ok: true,
      data: {
        ref:           app.ref,
        destination:   app.destination,
        status:        app.status,
        statusHistory: app.statusHistory.map(h => ({
          status: h.status,
          note:   h.note,
          date:   h.createdAt,
        })),
      }
    });
  } catch (err) { next(err); }
};

// ─── Format helper ────────────────────────────────────────────────────────────
const formatApp = (app) => ({
  ...app,
  fee: app.fee / 100, // return in naira
  status: app.status.toLowerCase(),
  statusHistory: (app.statusHistory || []).map(h => ({
    status: h.status.toLowerCase(),
    note:   h.note,
    date:   h.createdAt,
  })),
});
