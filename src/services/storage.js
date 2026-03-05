const { S3Client, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const multer = require('multer');
const multerS3 = require('multer-s3');
const multerLocal = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');

const USE_S3 = !!(config.aws.accessKeyId && config.aws.secretAccessKey);

// ─── Local disk storage (fallback when no S3 credentials) ────────────────────
const UPLOAD_DIR = path.join('/tmp', 'jekafly-uploads');
if (!USE_S3) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

let upload;

if (USE_S3) {
  const s3 = new S3Client({
    region: config.aws.region,
    credentials: {
      accessKeyId: config.aws.accessKeyId,
      secretAccessKey: config.aws.secretAccessKey,
    },
  });

  upload = multer({
    storage: multerS3({
      s3,
      bucket: config.aws.bucket,
      contentType: multerS3.AUTO_CONTENT_TYPE,
      key: (req, file, cb) => {
        const userId = req.user.id;
        const ref = req.body.ref || 'general';
        const ext = path.extname(file.originalname);
        const fname = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
        cb(null, `documents/${userId}/${ref}/${fname}`);
      },
    }),
    limits: { fileSize: MAX_SIZE },
    fileFilter: (req, file, cb) => {
      ALLOWED_TYPES.includes(file.mimetype)
        ? cb(null, true)
        : cb(new Error('Only PDF, JPG, and PNG files are allowed.'));
    },
  });

  module.exports.getSignedDownloadUrl = async (key, expiresIn = 3600) => {
    const command = new GetObjectCommand({ Bucket: config.aws.bucket, Key: key });
    return getSignedUrl(s3, command, { expiresIn });
  };

  module.exports.deleteFile = async (key) => {
    await s3.send(new DeleteObjectCommand({ Bucket: config.aws.bucket, Key: key }));
  };

} else {
  // ── Local disk fallback ──────────────────────────────────────────────────
  console.log('⚠️  No AWS credentials — using local disk storage for uploads.');

  const diskStorage = multerLocal.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const fname = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      cb(null, fname);
    },
  });

  upload = multerLocal({
    storage: diskStorage,
    limits: { fileSize: MAX_SIZE },
    fileFilter: (req, file, cb) => {
      ALLOWED_TYPES.includes(file.mimetype)
        ? cb(null, true)
        : cb(new Error('Only PDF, JPG, and PNG files are allowed.'));
    },
  });

  // Patch: multer-s3 sets file.key — local multer sets file.filename
  // We need to add a .key to each file so the controller works the same way
  const originalUploadArray = upload.array.bind(upload);
  const originalUploadSingle = upload.single.bind(upload);
  const originalUploadFields = upload.fields.bind(upload);
  const originalUploadAny = upload.any.bind(upload);

  const patchFiles = (req, res, next) => {
    if (req.files) {
      req.files = req.files.map(f => ({
        ...f,
        key: `local/${f.filename}`,  // mimic S3 key format
      }));
    }
    if (req.file) {
      req.file.key = `local/${req.file.filename}`;
    }
    next();
  };

  // Wrap upload middleware to patch files after upload
  const wrapMiddleware = (fn) => (...args) => {
    const middleware = fn(...args);
    return (req, res, next) => {
      middleware(req, res, (err) => {
        if (err) return next(err);
        patchFiles(req, res, next);
      });
    };
  };

  upload = {
    array: wrapMiddleware(originalUploadArray),
    single: wrapMiddleware(originalUploadSingle),
    fields: wrapMiddleware(originalUploadFields),
    any: wrapMiddleware(originalUploadAny),
  };

  module.exports.getSignedDownloadUrl = async (key) => {
    // Return a placeholder URL for local storage
    if (key && key.startsWith('local/')) {
      const filename = key.replace('local/', '');
      return `/uploads/${filename}`;
    }
    return '#';
  };

  module.exports.deleteFile = async (key) => {
    if (key && key.startsWith('local/')) {
      const filename = key.replace('local/', '');
      const filepath = path.join(UPLOAD_DIR, filename);
      try { fs.unlinkSync(filepath); } catch { }
    }
  };
}

module.exports.upload = upload;