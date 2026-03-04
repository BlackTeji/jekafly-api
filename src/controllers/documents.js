const prisma = require('../utils/prisma');
const { ApiError } = require('../middleware/error');
const { getSignedDownloadUrl, deleteFile } = require('../services/storage');

// ─── POST /documents/upload ───────────────────────────────────────────────────
exports.upload = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      throw new ApiError('No files uploaded.', 400);
    }

    const { ref, docIndex } = req.body;
    let applicationId = null;

    if (ref) {
      const app = await prisma.application.findUnique({ where: { ref } });
      if (!app) throw new ApiError('Application not found.', 404);
      if (app.userId !== req.user.id && req.user.role !== 'ADMIN') {
        throw new ApiError('Not authorised.', 403);
      }
      applicationId = app.id;
    }

    const docs = await Promise.all(req.files.map((file, i) =>
      prisma.document.create({
        data: {
          userId:        req.user.id,
          applicationId,
          name:          file.originalname,
          key:           file.key,        // S3 key from multer-s3
          mimeType:      file.mimetype,
          size:          file.size,
          docIndex:      docIndex != null ? parseInt(docIndex) + i : null,
        },
      })
    ));

    // Build signed URLs for immediate preview
    const uploaded = await Promise.all(docs.map(async (doc) => ({
      id:         doc.id,
      name:       doc.name,
      mimeType:   doc.mimeType,
      size:       doc.size,
      docIndex:   doc.docIndex,
      uploadedAt: doc.uploadedAt,
      url:        await getSignedDownloadUrl(doc.key),
    })));

    res.status(201).json({ ok: true, data: { uploaded } });
  } catch (err) { next(err); }
};

// ─── GET /documents ───────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, parseInt(req.query.limit) || 50);
    const skip  = (page - 1) * limit;
    const where = { userId: req.user.id };

    if (req.query.ref) {
      const app = await prisma.application.findUnique({ where: { ref: req.query.ref } });
      if (app) where.applicationId = app.id;
    }

    const [documents, total] = await Promise.all([
      prisma.document.findMany({
        where, skip, take: limit,
        orderBy: { uploadedAt: 'desc' },
        include: { application: { select: { ref: true } } },
      }),
      prisma.document.count({ where }),
    ]);

    // Add signed URLs
    const docsWithUrls = await Promise.all(documents.map(async (d) => ({
      id:         d.id,
      name:       d.name,
      mimeType:   d.mimeType,
      size:       d.size,
      docIndex:   d.docIndex,
      ref:        d.application?.ref || null,
      uploadedAt: d.uploadedAt,
      signedUrl:  await getSignedDownloadUrl(d.key),
    })));

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

    const expiresIn = 3600; // 1 hour
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
